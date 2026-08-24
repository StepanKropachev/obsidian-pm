import type { App, Plugin } from 'obsidian'
import { TFile } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../test/fakeVault'
import { DEFAULT_SETTINGS, type PMSettings } from '../types'
import { VaultIndex } from './VaultIndex'

const expectDefined = <T>(value: T | null | undefined, message = 'expected value to be defined'): T => {
  if (value == null) throw new Error(message)
  return value
}

function projectNote(id: string, title: string, extra = ''): string {
  return `---\npm-project: true\nid: ${id}\ntitle: ${title}\n${extra}---\n\n# ${title}\n`
}

function taskNote(id: string, title: string, projectId: string, status = 'todo', due = ''): string {
  const dueLine = due ? `due: ${due}\n` : ''
  return `---\npm-task: true\nid: ${id}\nprojectId: ${projectId}\ntitle: ${title}\nstatus: ${status}\n${dueLine}---\n\n`
}

/** Collects the registrations a Plugin would clean up, so events can be driven in tests. */
function fakePlugin(): Plugin {
  return { registerEvent: () => undefined } as unknown as Plugin
}

describe('VaultIndex', () => {
  let vault: FakeVault
  let app: App
  let settings: PMSettings
  let index: VaultIndex

  beforeEach(() => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    vault = fake.vault
    app = fake.app as unknown as App
    settings = { ...DEFAULT_SETTINGS }
    index = new VaultIndex(app, () => settings)
  })

  it('finds projects anywhere in the vault, not just under the projects folder', async () => {
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap'))
    await vault.create('Work/Clients/Acme.md', projectNote('p2', 'Acme'))
    await vault.create('Inbox/note.md', '# just a note\n')
    index.build()

    expect(index.projectPaths()).toEqual(['Work/Clients/Acme.md', 'Projects/Roadmap.md'])
  })

  it('ignores a project note living inside another project task folder', async () => {
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap'))
    await vault.create('Projects/Roadmap_tasks/nested.md', projectNote('p2', 'Nested'))
    index.build()

    expect(index.projectPaths()).toEqual(['Projects/Roadmap.md'])
  })

  it('attributes tasks in a project folder to that project, and nests sub-projects', async () => {
    await vault.create('Projects/Roadmap/Roadmap.md', projectNote('p1', 'Roadmap'))
    await vault.create('Projects/Roadmap/_tasks/one.md', taskNote('t1', 'One', 'p1'))
    await vault.create('Projects/Roadmap/_tasks/Archive/two.md', taskNote('t2', 'Two', 'p1'))
    await vault.create('Projects/Roadmap/_tasks/loose.md', projectNote('p3', 'Loose'))
    await vault.create('Projects/Roadmap/Q3/Q3.md', projectNote('p2', 'Q3', 'parent: "[[Roadmap]]"\n'))
    index.build()

    expect(index.projectPaths()).toEqual(['Projects/Roadmap/Q3/Q3.md', 'Projects/Roadmap/Roadmap.md'])
    expect(index.projectPathForTask('Projects/Roadmap/_tasks/one.md')).toBe('Projects/Roadmap/Roadmap.md')
    expect(index.projectPathForTask('Projects/Roadmap/_tasks/Archive/two.md')).toBe('Projects/Roadmap/Roadmap.md')
    expect(index.childRefs('Projects/Roadmap/Roadmap.md').map((ref) => ref.path)).toEqual(['Projects/Roadmap/Q3/Q3.md'])
  })

  it('skips excluded folders', async () => {
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap'))
    await vault.create('Templates/Project template.md', projectNote('tpl', 'Template'))
    settings = { ...settings, excludedFolders: ['Templates'] }
    index.build()

    expect(index.projectPaths()).toEqual(['Projects/Roadmap.md'])
  })

  it('attributes tasks to their project by location', async () => {
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap'))
    await vault.create('Projects/Roadmap_tasks/one.md', taskNote('t1', 'One', 'p1'))
    await vault.create('Projects/Roadmap_tasks/Archive/two.md', taskNote('t2', 'Two', 'p1'))
    index.build()

    const refs = index.taskRefs('Projects/Roadmap.md')
    expect(refs.map((r) => r.id).sort()).toEqual(['t1', 't2'])
    expect(refs.find((r) => r.id === 't2')?.archived).toBe(true)
  })

  it('attributes a task moved out of the task folder by its projectId', async () => {
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap'))
    await vault.create('Elsewhere/stray.md', taskNote('t1', 'Stray', 'p1'))
    index.build()

    expect(index.taskRefs('Projects/Roadmap.md').map((r) => r.id)).toEqual(['t1'])
    expect(index.projectPathForTask('Elsewhere/stray.md')).toBe('Projects/Roadmap.md')
  })

  it('resolves a task indexed before its project', async () => {
    await vault.create('A stray task.md', taskNote('t1', 'Stray', 'p1'))
    await vault.create('Zulu.md', projectNote('p1', 'Zulu'))
    index.build()

    expect(index.taskRefs('Zulu.md').map((r) => r.id)).toEqual(['t1'])
  })

  it('counts tasks per project using the project palette when it defines one', async () => {
    const config = 'config:\n  statuses:\n    - id: shipped\n      complete: true\n'
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap', config))
    await vault.create('Projects/Roadmap_tasks/a.md', taskNote('t1', 'A', 'p1'))
    await vault.create('Projects/Roadmap_tasks/b.md', taskNote('t2', 'B', 'p1', 'shipped'))
    await vault.create('Projects/Roadmap_tasks/c.md', taskNote('t3', 'C', 'p1', 'done'))
    index.build()

    const ref = expectDefined(index.projectRef('Projects/Roadmap.md'))
    // 'shipped' comes from this project's palette; 'done' keeps its global complete flag
    // because the project's palette does not redefine it.
    expect(index.counts(ref)).toEqual({ total: 3, done: 2 })
  })

  it('counts a status the project palette redefines as open against its own flag', async () => {
    const config = 'config:\n  statuses:\n    - id: done\n      complete: false\n'
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap', config))
    await vault.create('Projects/Roadmap_tasks/a.md', taskNote('t1', 'A', 'p1'))
    await vault.create('Projects/Roadmap_tasks/b.md', taskNote('t2', 'B', 'p1', 'done'))
    index.build()

    expect(index.counts(expectDefined(index.projectRef('Projects/Roadmap.md')))).toEqual({ total: 2, done: 0 })
  })

  it('counts against the global palette when the project defines none', async () => {
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap'))
    await vault.create('Projects/Roadmap_tasks/a.md', taskNote('t1', 'A', 'p1'))
    await vault.create('Projects/Roadmap_tasks/b.md', taskNote('t2', 'B', 'p1', 'done'))
    index.build()

    expect(index.counts(expectDefined(index.projectRef('Projects/Roadmap.md')))).toEqual({ total: 2, done: 1 })
  })

  it('leaves archived tasks out of a project row', async () => {
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap'))
    await vault.create('Projects/Roadmap_tasks/a.md', taskNote('t1', 'A', 'p1', 'todo', '2020-01-01'))
    await vault.create('Projects/Roadmap_tasks/Archive/b.md', taskNote('t2', 'B', 'p1', 'todo', '2020-06-01'))
    index.build()

    const ref = expectDefined(index.projectRef('Projects/Roadmap.md'))
    expect(index.counts(ref)).toEqual({ total: 1, done: 0 })
    expect(index.dueSummary(ref)).toEqual({ overdue: 1, latestDue: '2020-01-01' })
  })

  it('counts a task once when a sync conflict leaves two notes with its id', async () => {
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap'))
    await vault.create('Projects/Roadmap_tasks/a.md', taskNote('t1', 'A', 'p1', 'todo', '2020-01-01'))
    await vault.create('Projects/Roadmap_tasks/a (conflict).md', taskNote('t1', 'A', 'p1', 'todo', '2020-01-01'))
    index.build()

    const ref = expectDefined(index.projectRef('Projects/Roadmap.md'))
    expect(index.counts(ref)).toEqual({ total: 1, done: 0 })
    expect(index.dueSummary(ref).overdue).toBe(1)
  })

  describe('nesting', () => {
    it('reads the parent from a wikilink and reports roots and children', async () => {
      await vault.create('Platform.md', projectNote('p1', 'Platform'))
      await vault.create('Work/Billing.md', projectNote('p2', 'Billing', 'parent: "[[Platform]]"\n'))
      await vault.create('Work/Search.md', projectNote('p3', 'Search', 'parent: "[[Platform]]"\n'))
      index.build()

      expect(index.rootRefs().map((r) => r.title)).toEqual(['Platform'])
      expect(index.childRefs('Platform.md').map((r) => r.title)).toEqual(['Billing', 'Search'])
      expect(index.parentOf('Work/Billing.md')?.title).toBe('Platform')
    })

    it('accepts a full path in the parent link', async () => {
      await vault.create('Work/Platform.md', projectNote('p1', 'Platform'))
      await vault.create('Billing.md', projectNote('p2', 'Billing', 'parent: "[[Work/Platform]]"\n'))
      index.build()

      expect(index.parentOf('Billing.md')?.path).toBe('Work/Platform.md')
    })

    it('treats a project with an unresolvable parent as a root', async () => {
      await vault.create('Billing.md', projectNote('p2', 'Billing', 'parent: "[[Nowhere]]"\n'))
      index.build()

      expect(index.rootRefs().map((r) => r.title)).toEqual(['Billing'])
    })

    it('breaks a parent cycle instead of hanging', async () => {
      await vault.create('A.md', projectNote('p1', 'A', 'parent: "[[B]]"\n'))
      await vault.create('B.md', projectNote('p2', 'B', 'parent: "[[A]]"\n'))
      index.build()

      expect(index.rootRefs().length).toBe(1)
      expect(index.descendantRefs(index.rootRefs()[0].path).length).toBe(1)
    })

    it('collects descendants through several levels', async () => {
      await vault.create('A.md', projectNote('p1', 'A'))
      await vault.create('B.md', projectNote('p2', 'B', 'parent: "[[A]]"\n'))
      await vault.create('C.md', projectNote('p3', 'C', 'parent: "[[B]]"\n'))
      index.build()

      expect(index.descendantRefs('A.md').map((r) => r.title)).toEqual(['B', 'C'])
    })

    it('rolls task counts up through the subtree', async () => {
      await vault.create('A.md', projectNote('p1', 'A'))
      await vault.create('A_tasks/a.md', taskNote('t1', 'A1', 'p1', 'done'))
      await vault.create('B.md', projectNote('p2', 'B', 'parent: "[[A]]"\n'))
      await vault.create('B_tasks/b.md', taskNote('t2', 'B1', 'p2'))
      await vault.create('B_tasks/c.md', taskNote('t3', 'B2', 'p2', 'done'))
      index.build()

      const root = expectDefined(index.projectRef('A.md'))
      expect(index.counts(root)).toEqual({ total: 1, done: 1 })
      expect(index.rollupCounts(root)).toEqual({ total: 3, done: 2 })
    })

    it('rolls overdue tasks and the last due date up through the subtree', async () => {
      await vault.create('A.md', projectNote('p1', 'A'))
      await vault.create('A_tasks/a.md', taskNote('t1', 'A1', 'p1', 'todo', '2020-01-05'))
      await vault.create('B.md', projectNote('p2', 'B', 'parent: "[[A]]"\n'))
      await vault.create('B_tasks/b.md', taskNote('t2', 'B1', 'p2', 'todo', '2020-02-01'))
      await vault.create('B_tasks/c.md', taskNote('t3', 'B2', 'p2', 'done', '2020-03-01'))
      index.build()

      const root = expectDefined(index.projectRef('A.md'))
      expect(index.dueSummary(root)).toEqual({ overdue: 1, latestDue: '2020-01-05' })
      expect(index.rollupDueSummary(root)).toEqual({ overdue: 2, latestDue: '2020-03-01' })
    })

    it('follows a parent link added after the build', async () => {
      await vault.create('A.md', projectNote('p1', 'A'))
      const child = await vault.create('B.md', projectNote('p2', 'B'))
      index.build()
      index.register(fakePlugin())

      await vault.process(child, (c) => c.replace('title: B', 'title: B\nparent: "[[A]]"'))
      expect(index.childRefs('A.md').map((r) => r.title)).toEqual(['B'])
    })
  })

  describe('cross-project references', () => {
    beforeEach(async () => {
      await vault.create('A.md', projectNote('p1', 'A'))
      await vault.create('B.md', projectNote('p2', 'B'))
      await vault.create('A_tasks/one.md', taskNote('t1', 'One', 'p1'))
      await vault.create(
        'B_tasks/two.md',
        `---\npm-task: true\nid: t2\nprojectId: p2\ntitle: Two\nstatus: todo\ndependencies:\n  - t1\n---\n`
      )
      index.build()
    })

    it('resolves a task id from any project', () => {
      expect(index.task('t1')?.path).toBe('A_tasks/one.md')
      expect(index.task('nope')).toBeNull()
    })

    it('reports what depends on a task, across projects', () => {
      expect(index.dependents('t1').map((r) => r.id)).toEqual(['t2'])
      expect(index.dependents('t2')).toEqual([])
    })

    it('sees a cycle that spans two projects', () => {
      // t2 already depends on t1, so making t1 depend on t2 closes the loop.
      expect(index.wouldCreateCycle('t1', 't2')).toBe(true)
      expect(index.wouldCreateCycle('t2', 't1')).toBe(false)
    })

    it('picks up a dependency added after the first read', async () => {
      index.register(fakePlugin())
      expect(index.dependentsMap().get('t2')).toBeUndefined()

      await vault.modify(
        expectDefined(vault.getAbstractFileByPath('A_tasks/one.md') as TFile | null),
        `---\npm-task: true\nid: t1\nprojectId: p1\ntitle: One\nstatus: todo\ndependencies:\n  - t2\n---\n`
      )

      expect(index.dependentsMap().get('t2')).toEqual(['t1'])
    })
  })

  describe('incremental maintenance', () => {
    beforeEach(async () => {
      await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap'))
      index.build()
      index.register(fakePlugin())
    })

    it('picks up a project created after the build', async () => {
      await vault.create('Later/Side quest.md', projectNote('p2', 'Side quest'))
      expect(index.projectPaths()).toContain('Later/Side quest.md')
    })

    it('picks up a task created after the build', async () => {
      await vault.create('Projects/Roadmap_tasks/a.md', taskNote('t1', 'A', 'p1'))
      expect(index.taskRefs('Projects/Roadmap.md').map((r) => r.id)).toEqual(['t1'])
    })

    it('follows a status edit', async () => {
      const file = await vault.create('Projects/Roadmap_tasks/a.md', taskNote('t1', 'A', 'p1'))
      await vault.process(file, (c) => c.replace('status: todo', 'status: done'))
      const ref = expectDefined(index.projectRef('Projects/Roadmap.md'))
      expect(index.counts(ref)).toEqual({ total: 1, done: 1 })
    })

    it('drops a note that stops being a project', async () => {
      const file = await vault.create('Later/Side quest.md', projectNote('p2', 'Side quest'))
      await vault.process(file, (c) => c.replace('pm-project: true', 'pm-project: false'))
      expect(index.projectPaths()).not.toContain('Later/Side quest.md')
    })

    it('drops a deleted project', async () => {
      await vault.trashFile(expectDefined(vault.getAbstractFileByPath('Projects/Roadmap.md')))
      expect(index.projectPaths()).toEqual([])
    })

    it('follows a renamed project file', async () => {
      await vault.rename(expectDefined(vault.getAbstractFileByPath('Projects/Roadmap.md')), 'Projects/Plan.md')
      expect(index.projectPaths()).toEqual(['Projects/Plan.md'])
    })

    it('keeps the tasks of a project whose file is renamed', async () => {
      await vault.create('Projects/Roadmap_tasks/a.md', taskNote('t1', 'A', 'p1'))
      await vault.rename(expectDefined(vault.getAbstractFileByPath('Projects/Roadmap.md')), 'Projects/Plan.md')

      expect(index.taskRefs('Projects/Plan.md').map((r) => r.id)).toEqual(['t1'])
      expect(index.counts(expectDefined(index.projectRef('Projects/Plan.md')))).toEqual({ total: 1, done: 0 })
    })

    it('follows the tasks of a renamed task folder', async () => {
      await vault.create('Projects/Roadmap_tasks/a.md', taskNote('t1', 'A', 'p1'))
      await vault.rename(expectDefined(vault.getAbstractFileByPath('Projects/Roadmap.md')), 'Projects/Plan.md')
      await vault.rename(expectDefined(vault.getAbstractFileByPath('Projects/Roadmap_tasks')), 'Projects/Plan_tasks')

      expect(expectDefined(index.task('t1')).path).toBe('Projects/Plan_tasks/a.md')
      expect(index.taskRefs('Projects/Plan.md').map((r) => r.id)).toEqual(['t1'])
      expect(index.projectPathForTask('Projects/Plan_tasks/a.md')).toBe('Projects/Plan.md')
    })

    it('follows a project moved with its folder', async () => {
      await vault.create('Later/Side quest.md', projectNote('p2', 'Side quest'))
      await vault.rename(expectDefined(vault.getAbstractFileByPath('Later')), 'Archive box')

      expect(index.projectPaths()).toContain('Archive box/Side quest.md')
      expect(index.projectPaths()).not.toContain('Later/Side quest.md')
    })

    it('reports changes to subscribers', async () => {
      let calls = 0
      index.onChange(() => calls++)
      await vault.create('Later/Side quest.md', projectNote('p2', 'Side quest'))
      expect(calls).toBe(1)
    })
  })
})

describe('VaultIndex people queries', () => {
  let vault: FakeVault
  let app: App
  let index: VaultIndex

  const assignedNote = (id: string, projectId: string, assignees: string): string =>
    `---\npm-task: true\nid: ${id}\nprojectId: ${projectId}\ntitle: T${id}\nstatus: todo\nassignees: ${assignees}\n---\n\n`

  beforeEach(async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    vault = fake.vault
    app = fake.app as unknown as App
    index = new VaultIndex(app, () => ({ ...DEFAULT_SETTINGS }))
    await vault.create('People/Jane Doe.md', '')
    await vault.create('Contacts/Jane Doe.md', '')
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap'))
    await vault.create('Projects/Roadmap_tasks/a.md', assignedNote('a', 'p1', '["[[People/Jane Doe|Jane Doe]]"]'))
    await vault.create('Projects/Roadmap_tasks/b.md', assignedNote('b', 'p1', '["[[Contacts/Jane Doe|Jane Doe]]"]'))
    await vault.create('Projects/Roadmap_tasks/c.md', assignedNote('c', 'p1', '["Bob Plain"]'))
    index.build()
  })

  it('reads assignees onto the task ref', () => {
    expect(expectDefined(index.task('c')).assignees).toEqual(['Bob Plain'])
  })

  it('finds the tasks assigned to one person', () => {
    const found = index.tasksForPerson('[[People/Jane Doe]]')
    expect(found.map((ref) => ref.id)).toEqual(['a'])
  })

  it('keeps two people with the same name apart', () => {
    expect(index.tasksForPerson('[[Contacts/Jane Doe]]').map((ref) => ref.id)).toEqual(['b'])
  })

  it('finds a person named as plain text', () => {
    expect(index.tasksForPerson('Bob Plain').map((ref) => ref.id)).toEqual(['c'])
  })

  it('lists everyone in the vault once', () => {
    expect(index.allAssignees()).toHaveLength(3)
  })
})

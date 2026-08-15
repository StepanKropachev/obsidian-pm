import type { App, Plugin } from 'obsidian'
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

function taskNote(id: string, title: string, projectId: string, status = 'todo'): string {
  return `---\npm-task: true\nid: ${id}\nprojectId: ${projectId}\ntitle: ${title}\nstatus: ${status}\n---\n\n`
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
    // 'done' is complete globally, but this project's own palette replaces that list.
    expect(index.counts(ref)).toEqual({ total: 3, done: 1 })
  })

  it('counts against the global palette when the project defines none', async () => {
    await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap'))
    await vault.create('Projects/Roadmap_tasks/a.md', taskNote('t1', 'A', 'p1'))
    await vault.create('Projects/Roadmap_tasks/b.md', taskNote('t2', 'B', 'p1', 'done'))
    index.build()

    expect(index.counts(expectDefined(index.projectRef('Projects/Roadmap.md')))).toEqual({ total: 2, done: 1 })
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

    it('reports changes to subscribers', async () => {
      let calls = 0
      index.onChange(() => calls++)
      await vault.create('Later/Side quest.md', projectNote('p2', 'Side quest'))
      expect(calls).toBe(1)
    })
  })
})

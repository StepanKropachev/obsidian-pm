import type { App } from 'obsidian'
import { TFile } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../test/fakeVault'
import type PMPlugin from '../main'
import { ProjectStore, VaultIndex } from '../store'
import type { ProjectRef, TaskRef } from '../store'
import { DEFAULT_SETTINGS, type PMSettings } from '../types'
import { IdRepair, planIdRepairs } from './IdRepair'

const expectDefined = <T>(value: T | null | undefined, message = 'expected value to be defined'): T => {
  if (value == null) throw new Error(message)
  return value
}

function taskRef(id: string, projectPath: string): TaskRef {
  return {
    id,
    path: `${projectPath.replace(/\.md$/, '')}_tasks/${id}.md`,
    projectId: '',
    projectPath,
    title: id,
    status: 'todo',
    priority: 'medium',
    start: '',
    due: '',
    completed: '',
    dependencies: [],
    assignees: [],
    archived: false
  }
}

function projectRef(id: string, path: string): ProjectRef {
  return {
    path,
    id,
    title: id,
    icon: '',
    color: '',
    teamMembers: [],
    customFields: [],
    parentPath: undefined,
    ownStatusIds: null,
    completeStatusIds: null,
    autoArchiveDays: null
  }
}

describe('planIdRepairs', () => {
  it('keeps ids in the project whose note is oldest and reassigns the rest', () => {
    const collisions = new Map([['t1', [taskRef('t1', 'A.md'), taskRef('t1', 'B.md')]]])
    const ctimes: Record<string, number> = { 'A.md': 100, 'B.md': 200 }

    const plans = planIdRepairs(collisions, new Map(), (path) => ctimes[path])

    expect(plans).toEqual([{ projectPath: 'B.md', taskIds: ['t1'], newProjectId: false }])
  })

  it('breaks a creation-time tie by path', () => {
    const collisions = new Map([['t1', [taskRef('t1', 'B.md'), taskRef('t1', 'A.md')]]])

    const plans = planIdRepairs(collisions, new Map(), () => 100)

    expect(plans).toEqual([{ projectPath: 'B.md', taskIds: ['t1'], newProjectId: false }])
  })

  it('waits on a group whose note files are not all readable yet', () => {
    const collisions = new Map([['t1', [taskRef('t1', 'A.md'), taskRef('t1', 'B.md')]]])
    const ctimes: Record<string, number | null> = { 'A.md': 100, 'B.md': null }

    expect(planIdRepairs(collisions, new Map(), (path) => ctimes[path] ?? null)).toEqual([])
  })

  it('folds a project id collision into the same plan', () => {
    const taskCollisions = new Map([['t1', [taskRef('t1', 'A.md'), taskRef('t1', 'B.md')]]])
    const projectCollisions = new Map([['p1', [projectRef('p1', 'A.md'), projectRef('p1', 'B.md')]]])
    const ctimes: Record<string, number> = { 'A.md': 100, 'B.md': 200 }

    const plans = planIdRepairs(taskCollisions, projectCollisions, (path) => ctimes[path])

    expect(plans).toEqual([{ projectPath: 'B.md', taskIds: ['t1'], newProjectId: true }])
  })

  it('plans a project id repair even when no task ids collide', () => {
    const projectCollisions = new Map([['p1', [projectRef('p1', 'A.md'), projectRef('p1', 'B.md')]]])
    const ctimes: Record<string, number> = { 'A.md': 100, 'B.md': 200 }

    const plans = planIdRepairs(new Map(), projectCollisions, (path) => ctimes[path])

    expect(plans).toEqual([{ projectPath: 'B.md', taskIds: [], newProjectId: true }])
  })
})

describe('IdRepair sweep', () => {
  let app: App
  let vault: FakeVault
  let index: VaultIndex
  let store: ProjectStore
  let notices: string[]
  let repair: IdRepair

  beforeEach(() => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    vault = fake.vault
    app = fake.app as unknown as App
    const settings: PMSettings = structuredClone(DEFAULT_SETTINGS)
    index = new VaultIndex(app, () => settings)
    store = new ProjectStore(app, () => settings, index)
    notices = []
    const plugin = {
      app,
      index,
      store,
      showNotice: (msg: string) => notices.push(msg)
    } as unknown as PMPlugin
    repair = new IdRepair(plugin)
  })

  function projectNote(taskIds: string[]): string {
    const ids = taskIds.map((id) => `"${id}"`).join(', ')
    return `---\npm-project: true\nid: pjt1\ntitle: Template\ntaskIds: [${ids}]\n---\n\n# Template\n`
  }

  function taskNote(id: string, title: string, deps: string[]): string {
    const list = deps.map((dep) => `"${dep}"`).join(', ')
    return `---\npm-task: true\nid: ${id}\nprojectId: pjt1\ntitle: ${title}\nstatus: todo\ndependencies: [${list}]\n---\n`
  }

  async function createCopiedPair(): Promise<void> {
    for (const folder of ['Template', 'Copy']) {
      await vault.create(`Projects/${folder}/${folder}.md`, projectNote(['t1', 't2']))
      await vault.create(`Projects/${folder}/_tasks/one.md`, taskNote('t1', 'One', []))
      await vault.create(`Projects/${folder}/_tasks/two.md`, taskNote('t2', 'Two', ['t1']))
    }
    setCtime('Projects/Template/Template.md', 100)
    setCtime('Projects/Copy/Copy.md', 200)
  }

  function setCtime(path: string, ctime: number): void {
    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) throw new Error(`no file at ${path}`)
    file.stat.ctime = ctime
  }

  it('gives the newer copy fresh ids and leaves the original alone', async () => {
    await createCopiedPair()
    index.build()
    vault.resetCounts()

    await repair.check()

    expect(notices).toEqual(['Repaired duplicated ids in "Template" (copied project).'])
    for (const path of vault.modifyCount.keys()) {
      expect(path.startsWith('Projects/Copy/')).toBe(true)
    }

    const copy = expectDefined(await store.loadProjectByPath('Projects/Copy/Copy.md'))
    expect(copy.id).not.toBe('pjt1')
    const one = expectDefined(copy.tasks.find((t) => t.title === 'One'))
    const two = expectDefined(copy.tasks.find((t) => t.title === 'Two'))
    expect(one.id).not.toBe('t1')
    expect(two.id).not.toBe('t2')
    expect(two.dependencies).toEqual([one.id])

    const template = expectDefined(await store.loadProjectByPath('Projects/Template/Template.md'))
    expect(template.id).toBe('pjt1')
    expect(template.tasks.map((t) => t.id).sort()).toEqual(['t1', 't2'])
  })

  it('finds nothing to do on a second pass', async () => {
    await createCopiedPair()
    index.build()

    await repair.check()
    index.build()
    vault.resetCounts()
    await repair.check()

    expect(notices).toHaveLength(1)
    expect(vault.modifyCount.size).toBe(0)
  })
})

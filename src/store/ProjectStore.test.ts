import type { App, Plugin } from 'obsidian'
import { TFile, TFolder } from 'obsidian'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../test/fakeVault'
import { today } from '../dates'
import {
  DEFAULT_SETTINGS,
  makeDefaultFilter,
  makeTask,
  type PMSettings,
  type Project,
  type StatusConfig,
  type Task
} from '../types'
import { ProjectStore } from './ProjectStore'
import { projectTaskFolder } from './vaultFs'
import { addDays } from './Scheduler'
import { buildTaskIndex } from './TaskIndex'
import { findTask, flattenTasks } from './TaskTreeOps'
import { VaultIndex } from './VaultIndex'

const expectDefined = <T>(value: T | null | undefined, message = 'expected value to be defined'): T => {
  if (value == null) throw new Error(message)
  return value
}

const STATUSES: StatusConfig[] = [
  { id: 'todo', label: 'Todo', color: '#888', icon: 'circle', complete: false },
  { id: 'in-progress', label: 'In progress', color: '#88f', icon: 'loader', complete: false },
  { id: 'done', label: 'Done', color: '#0a0', icon: 'check', complete: true }
]

const SETTINGS: PMSettings = { ...DEFAULT_SETTINGS, statuses: STATUSES }

function newStore(): { store: ProjectStore; vault: FakeVault; app: App } {
  const { app, vault } = makeFakeApp()
  const store = new ProjectStore(app as unknown as App, () => SETTINGS)
  return { store, vault, app: app as unknown as App }
}

function newIndexedStore(): { store: ProjectStore; index: VaultIndex; app: App } {
  const { app } = makeFakeApp({ liveMetadataCache: true })
  const typed = app as unknown as App
  const index = new VaultIndex(typed, () => SETTINGS)
  const store = new ProjectStore(typed, () => SETTINGS, index)
  return { store, index, app: typed }
}

function fileAt(app: App, path: string): TFile {
  const file = app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile)) throw new Error(`no file at ${path}`)
  return file
}

async function readStatus(app: App, path: string): Promise<string> {
  const content = await app.vault.cachedRead(fileAt(app, path))
  return (/^status:\s*(.*)$/m.exec(content)?.[1] ?? '').replace(/"/g, '')
}

/** An edit the plugin did not make, e.g. from another device or a markdown tab. */
async function editOnDisk(app: App, path: string, edit: (content: string) => string): Promise<void> {
  const file = fileAt(app, path)
  await app.vault.modify(file, edit(await app.vault.cachedRead(file)))
}

async function addNamed(
  store: ProjectStore,
  project: Parameters<ProjectStore['insertTask']>[0],
  title: string,
  parentId: string | null = null
): Promise<Task> {
  const task = makeTask({ title })
  await store.insertTask(project, task, parentId)
  return task
}

describe('ProjectStore live project instance', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('gives concurrent loaders the same instance', async () => {
    const { store, app } = newStore()
    const project = await store.createProject('Race', 'Projects')
    await addNamed(store, project, 'Card')

    // A second store stands in for a cold start, with several callers racing to load.
    const cold = new ProjectStore(app, () => SETTINGS)
    const file = fileAt(app, project.filePath)
    const [a, b] = await Promise.all([cold.loadProject(file), cold.loadProject(file)])

    expect(a).not.toBeNull()
    expect(a).toBe(b)
  })

  it('keeps the instance holders already have when another copy is saved', async () => {
    const { store, app } = newStore()
    const project = await store.createProject('Held', 'Projects')
    const task = await addNamed(store, project, 'Card')
    const held = expectDefined(await store.loadProject(fileAt(app, project.filePath)))

    // A detached copy, as a form working on its own draft would produce.
    const copy = JSON.parse(JSON.stringify(held)) as Project
    copy.taskIndex = buildTaskIndex(copy.tasks)
    copy.title = 'Detached'
    await store.saveProject(copy)

    expect(await store.loadProject(fileAt(app, project.filePath))).toBe(held)

    // The copy's stale tasks never become the live tree.
    await store.updateTask(held, task.id, { status: 'done' })
    await store.saveProject(copy)
    expect(await readStatus(app, expectDefined(task.filePath))).toBe('done')
  })

  it('reloads an external edit into the instance holders have', async () => {
    const { store, app } = newStore()
    const plugin = { registerEvent: () => {}, register: () => {} } as unknown as Plugin
    store.registerVaultSync(plugin)
    const project = await store.createProject('Synced', 'Projects')
    const task = await addNamed(store, project, 'Card')
    const held = expectDefined(await store.loadProject(fileAt(app, project.filePath)))
    const changes: string[] = []
    store.onProjectChanged((path) => changes.push(path))
    await vi.advanceTimersByTimeAsync(6000) // past the self-write window

    await editOnDisk(app, expectDefined(task.filePath), (c) => c.replace('status: "todo"', 'status: "done"'))
    await vi.advanceTimersByTimeAsync(400)

    expect(expectDefined(findTask(held.tasks, task.id)).status).toBe('done')
    expect(changes).toEqual([project.filePath])
  })

  it('does not reload its own writes', async () => {
    const { store, app } = newStore()
    const plugin = { registerEvent: () => {}, register: () => {} } as unknown as Plugin
    store.registerVaultSync(plugin)
    const project = await store.createProject('Quiet', 'Projects')
    const task = await addNamed(store, project, 'Card')
    const held = expectDefined(await store.loadProject(fileAt(app, project.filePath)))
    const liveTask = expectDefined(findTask(held.tasks, task.id))

    await store.updateTask(held, task.id, { status: 'in-progress' })
    await vi.advanceTimersByTimeAsync(400)

    // A reload would have replaced the task objects in the tree.
    expect(findTask(held.tasks, task.id)).toBe(liveTask)
  })

  it('does not let one view revert a change made in another', async () => {
    const { store, app } = newStore()
    const project = await store.createProject('Two views', 'Projects')
    const task = await addNamed(store, project, 'Card')
    const taskPath = expectDefined(task.filePath)
    const viewA = expectDefined(await store.loadProject(fileAt(app, project.filePath)))
    const viewB = expectDefined(await store.loadProject(fileAt(app, project.filePath)))

    await store.updateTask(viewA, task.id, { status: 'done' })
    await store.updateTask(viewB, task.id, { priority: 'high' })

    expect(await readStatus(app, taskPath)).toBe('done')
  })

  it('notifies on every change, whoever made it', async () => {
    const { store } = newStore()
    const project = await store.createProject('Notified', 'Projects')
    const changes: string[] = []
    const unsubscribe = store.onProjectChanged((path) => changes.push(path))

    const task = await addNamed(store, project, 'Card')
    await store.updateTask(project, task.id, { status: 'done' })
    expect(changes).toEqual([project.filePath, project.filePath])

    unsubscribe()
    await store.updateTask(project, task.id, { status: 'todo' })
    expect(changes).toHaveLength(2)
  })
})

describe('ProjectStore project metadata patch', () => {
  it('writes only the patched fields', async () => {
    const { store, app } = newStore()
    const project = await store.createProject('Patch', 'Projects')
    await addNamed(store, project, 'Card')
    project.savedViews = [{ id: 'v1', name: 'Mine', filter: makeDefaultFilter(), sortKey: 'status', sortDir: 'asc' }]
    await store.saveProject(project)

    await store.updateProject(project, { title: 'Renamed', color: '#123456' })

    expect(project.title).toBe('Renamed')
    expect(project.savedViews).toHaveLength(1)
    const content = await app.vault.cachedRead(fileAt(app, project.filePath))
    expect(content).toContain('title: "Renamed"')
    expect(content).toContain('color: "#123456"')
    expect(content).toContain('Mine')
  })
})

describe('ProjectStore dirty-set save efficiency', () => {
  it('does not rewrite task files when nothing is dirty', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Clean', 'Projects')
    const a = await addNamed(store, project, 'Alpha')
    const b = await addNamed(store, project, 'Beta')
    vault.resetCounts()

    // No mutations, but force a save by updating a non-existent id.
    await store.updateTask(project, 'missing-id', {})

    expect(vault.modifyCount.get(expectDefined(a.filePath)) ?? 0).toBe(0)
    expect(vault.modifyCount.get(expectDefined(b.filePath)) ?? 0).toBe(0)
    expect(vault.modifyCount.get(project.filePath)).toBe(1)
  })

  it('rewrites only the updated task on a single-field update', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('One', 'Projects')
    const a = await addNamed(store, project, 'Alpha')
    const b = await addNamed(store, project, 'Beta')
    const c = await addNamed(store, project, 'Gamma')
    vault.resetCounts()

    await store.updateTask(project, b.id, { priority: 'high' })

    expect(vault.modifyCount.get(expectDefined(a.filePath)) ?? 0).toBe(0)
    expect(vault.modifyCount.get(expectDefined(b.filePath))).toBe(1)
    expect(vault.modifyCount.get(expectDefined(c.filePath)) ?? 0).toBe(0)
  })

  it('rewrites direct children when a parent title changes', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Family', 'Projects')
    const parent = await addNamed(store, project, 'Parent')
    const child1 = await addNamed(store, project, 'Child one', parent.id)
    const child2 = await addNamed(store, project, 'Child two', parent.id)
    vault.resetCounts()

    await store.updateTask(project, parent.id, { title: 'New parent' })

    // Parent file is renamed (create new + trash old), not modified.
    expect(vault.modifyCount.get(expectDefined(parent.filePath)) ?? 0).toBe(0)
    // Children stay at the same path but get rewritten because their Parent link broke.
    expect(vault.modifyCount.get(expectDefined(child1.filePath))).toBe(1)
    expect(vault.modifyCount.get(expectDefined(child2.filePath))).toBe(1)
  })

  it('rewrites both old and new parent on moveTask', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Move', 'Projects')
    const p1 = await addNamed(store, project, 'Parent one')
    const p2 = await addNamed(store, project, 'Parent two')
    const child = await addNamed(store, project, 'Child', p1.id)
    vault.resetCounts()

    await store.moveTask(project, child.id, p2.id)

    expect(vault.modifyCount.get(expectDefined(p1.filePath))).toBe(1)
    expect(vault.modifyCount.get(expectDefined(p2.filePath))).toBe(1)
    expect(vault.modifyCount.get(expectDefined(child.filePath))).toBe(1)
  })

  it('rewrites the parent (not the deleted task) on deleteTask', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Delete', 'Projects')
    const parent = await addNamed(store, project, 'Keep')
    const child = await addNamed(store, project, 'Goner', parent.id)
    const childPath = expectDefined(child.filePath)
    vault.resetCounts()

    await store.deleteTask(project, child.id)

    expect(vault.trashCount.get(childPath)).toBe(1)
    expect(vault.modifyCount.get(expectDefined(parent.filePath))).toBe(1)
  })
})

describe('ProjectStore round-trip', () => {
  it('reloads tasks created via mutators with the same state', async () => {
    const { store, vault, app } = newStore()
    const project = await store.createProject('Round', 'Projects')
    const a = await addNamed(store, project, 'Design')
    const b = await addNamed(store, project, 'Build')
    await store.updateTask(project, a.id, {
      priority: 'high',
      assignees: ['Alice'],
      tags: ['design']
    })
    await store.updateTask(project, b.id, { status: 'in-progress' })
    const childOfA = await addNamed(store, project, 'Sub of design', a.id)

    const store2 = new ProjectStore(app, () => SETTINGS)
    const file = vault.getAbstractFileByPath(project.filePath)
    if (!(file instanceof TFile)) throw new Error('project file missing')
    const reloaded = await store2.loadProject(file)
    if (!reloaded) throw new Error('failed to reload')

    expect(reloaded.title).toBe('Round')
    const flat = flattenTasks(reloaded.tasks)
    const ids = new Set(flat.map((f) => f.task.id))
    expect(ids.has(a.id)).toBe(true)
    expect(ids.has(b.id)).toBe(true)
    expect(ids.has(childOfA.id)).toBe(true)

    const reloadedA = expectDefined(flat.find((f) => f.task.id === a.id)).task
    expect(reloadedA.title).toBe('Design')
    expect(reloadedA.priority).toBe('high')
    expect(reloadedA.assignees).toEqual(['Alice'])
    expect(reloadedA.tags).toEqual(['design'])
    expect(reloadedA.subtasks.map((s) => s.id)).toEqual([childOfA.id])

    const reloadedB = expectDefined(flat.find((f) => f.task.id === b.id)).task
    expect(reloadedB.status).toBe('in-progress')
  })

  it('writes the parent as a wikilink and resolves it back on load', async () => {
    const { app, vault } = makeFakeApp({ liveMetadataCache: true })
    const store = new ProjectStore(app as unknown as App, () => SETTINGS)
    await store.createProject('Platform', 'Projects')
    const child = await store.createProject('Billing', 'Work')
    await store.updateProject(child, { parentPath: 'Projects/Platform/Platform.md' })

    const content = await vault.cachedRead(fileAt(app as unknown as App, child.filePath))
    expect(content).toContain('parent: "[[Projects/Platform/Platform]]"')

    const store2 = new ProjectStore(app as unknown as App, () => SETTINGS)
    const reloaded = await store2.loadProject(fileAt(app as unknown as App, child.filePath))
    expect(reloaded?.parentPath).toBe('Projects/Platform/Platform.md')
  })

  it('migrates an old-format (embedded tasks) project on load and save', async () => {
    const { store, vault } = newStore()
    // Manually write an old-format project file (tasks embedded in frontmatter).
    const oldFm = [
      '---',
      'pm-project: true',
      'id: legacy',
      'title: Legacy',
      'tasks:',
      '  - id: t1',
      '    title: First',
      '    status: todo',
      '  - id: t2',
      '    title: Second',
      '    status: done',
      '---',
      ''
    ].join('\n')
    await vault.create('Projects/Legacy.md', oldFm)

    const file = vault.getAbstractFileByPath('Projects/Legacy.md')
    if (!(file instanceof TFile)) throw new Error('legacy file missing')
    const project = await store.loadProject(file)
    if (!project) throw new Error('load failed')

    // markAllDirty should have flagged every embedded task; saving once writes them all.
    await store.saveProject(project)

    expect(vault.getAbstractFileByPath('Projects/Legacy_tasks/first.md')).not.toBeNull()
    expect(vault.getAbstractFileByPath('Projects/Legacy_tasks/second.md')).not.toBeNull()

    const reloaded = await store.loadProject(file)
    if (!reloaded) throw new Error('reload failed')
    const flat = flattenTasks(reloaded.tasks)
    expect(flat.map((f) => f.task.title).sort()).toEqual(['First', 'Second'])
  })
})

describe('ProjectStore completion date', () => {
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

  it('stamps completed when a task enters a complete status and clears it on exit', async () => {
    const { store } = newStore()
    const project = await store.createProject('Done dates', 'Projects')
    const task = await addNamed(store, project, 'Ship it')
    expect(task.completed).toBe('')

    await store.updateTask(project, task.id, { status: 'done' })
    expect(task.completed).toMatch(ISO_DATE)

    await store.updateTask(project, task.id, { status: 'in-progress' })
    expect(task.completed).toBe('')
  })

  it('does not restamp when status changes between two complete statuses or stays put', async () => {
    const { store } = newStore()
    const project = await store.createProject('Stable', 'Projects')
    const task = await addNamed(store, project, 'Edit me')
    await store.updateTask(project, task.id, { status: 'done' })
    const stamped = task.completed
    expect(stamped).toMatch(ISO_DATE)

    // A non-status edit leaves the date alone.
    await store.updateTask(project, task.id, { title: 'Edited' })
    expect(task.completed).toBe(stamped)
  })

  it('stamps from a full-task patch that already carries the unchanged completed field', async () => {
    // The editor saves the whole task, so `completed` is present and unchanged;
    // auto-stamping must still fire on the status flip.
    const { store } = newStore()
    const project = await store.createProject('Modal', 'Projects')
    const task = await addNamed(store, project, 'Via modal')
    await store.updateTask(project, task.id, { ...task, status: 'done', completed: '' })
    expect(task.completed).toMatch(ISO_DATE)
  })

  it('respects an explicit completion date in the patch over auto-stamping', async () => {
    const { store } = newStore()
    const project = await store.createProject('Manual', 'Projects')
    const task = await addNamed(store, project, 'Backdated')
    await store.updateTask(project, task.id, { status: 'done', completed: '2025-01-15' })
    expect(task.completed).toBe('2025-01-15')
  })

  it('persists the completion date across a reload', async () => {
    const { store, vault, app } = newStore()
    const project = await store.createProject('Persisted', 'Projects')
    const task = await addNamed(store, project, 'Archive me')
    await store.updateTask(project, task.id, { status: 'done' })

    const store2 = new ProjectStore(app, () => SETTINGS)
    const file = vault.getAbstractFileByPath(project.filePath)
    if (!(file instanceof TFile)) throw new Error('project file missing')
    const reloaded = await store2.loadProject(file)
    if (!reloaded) throw new Error('reload failed')
    const reloadedTask = expectDefined(flattenTasks(reloaded.tasks).find((f) => f.task.id === task.id)).task
    expect(reloadedTask.completed).toMatch(ISO_DATE)
  })

  it('stamps a task inserted directly in a complete status', async () => {
    const { store } = newStore()
    const project = await store.createProject('Insert done', 'Projects')
    const task = makeTask({ title: 'Born done', status: 'done' })
    await store.insertTask(project, task)
    expect(task.completed).toMatch(ISO_DATE)
  })

  it('does not bleed one task completion date onto another in a bulk update', async () => {
    const { store } = newStore()
    const project = await store.createProject('Bulk', 'Projects')
    const open = await addNamed(store, project, 'Still open')
    const finishing = await addNamed(store, project, 'Finishing')
    await store.updateTask(project, finishing.id, { status: 'done' })
    open.completed = ''

    // A shared patch must not carry the done task's stamped date onto the open one.
    await store.updateTasks(project, [finishing.id, open.id], { priority: 'high' })
    expect(open.completed).toBe('')
  })
})

describe('ProjectStore pull-forward on early finish', () => {
  const BLOCKER_DUE = '2099-06-10'

  async function chain(pullForward: boolean): Promise<{ store: ProjectStore; project: Project; blocked: Task }> {
    const { app } = makeFakeApp()
    const store = new ProjectStore(app as unknown as App, () => ({
      ...SETTINGS,
      pullForwardOnEarlyFinish: pullForward
    }))
    const project = await store.createProject('Early', 'Projects')
    const blocker = makeTask({ title: 'Blocker', due: BLOCKER_DUE })
    await store.insertTask(project, blocker)
    const blocked = makeTask({
      title: 'Blocked',
      start: addDays(BLOCKER_DUE, 1),
      due: addDays(BLOCKER_DUE, 2),
      dependencies: [blocker.id]
    })
    await store.insertTask(project, blocked)
    await store.updateTask(project, blocker.id, { status: 'done' })
    return { store, project, blocked }
  }

  it('pulls a dependent back when its blocker is completed ahead of its due date', async () => {
    const { blocked } = await chain(true)
    const finishedOn = today().toString()
    expect(blocked.start).toBe(addDays(finishedOn, 1))
    expect(blocked.due).toBe(addDays(finishedOn, 2))
  })

  it('leaves the dependent in place when the option is off', async () => {
    const { blocked } = await chain(false)
    expect(blocked.start).toBe(addDays(BLOCKER_DUE, 1))
  })

  it('keeps a project-level override across a reload', async () => {
    const { store, vault, app } = newStore()
    const project = await store.createProject('Override', 'Projects')
    project.config = { pullForwardOnEarlyFinish: true }
    await store.saveProject(project)

    const file = vault.getAbstractFileByPath(project.filePath)
    if (!(file instanceof TFile)) throw new Error('project file missing')
    const reloaded = expectDefined(await new ProjectStore(app, () => SETTINGS).loadProject(file))
    expect(reloaded.config?.pullForwardOnEarlyFinish).toBe(true)
  })

  it('pushes the dependent back out when the blocker is reopened', async () => {
    const { store, project, blocked } = await chain(true)
    const blocker = expectDefined(flattenTasks(project.tasks).find((f) => f.task.title === 'Blocker')).task
    await store.updateTask(project, blocker.id, { status: 'todo' })
    expect(blocked.start).toBe(addDays(BLOCKER_DUE, 1))
  })
})

describe('ProjectStore task attachments', () => {
  it('saves an attachment under the task own attachments folder', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Imgs', 'Projects')
    const task = await addNamed(store, project, 'Shot')

    const file = await store.saveTaskAttachment(project, task, 'pic.png', new ArrayBuffer(4))

    expect(file.path).toBe('Projects/Imgs/_tasks/shot/attachments/pic.png')
    expect(vault.getAbstractFileByPath('Projects/Imgs/_tasks/shot/attachments/pic.png')).not.toBeNull()
  })

  it('disambiguates a colliding attachment name', async () => {
    const { store } = newStore()
    const project = await store.createProject('Imgs', 'Projects')
    const task = await addNamed(store, project, 'Shot')

    const first = await store.saveTaskAttachment(project, task, 'pic.png', new ArrayBuffer(4))
    const second = await store.saveTaskAttachment(project, task, 'pic.png', new ArrayBuffer(4))

    expect(first.path).toBe('Projects/Imgs/_tasks/shot/attachments/pic.png')
    expect(second.path).toBe('Projects/Imgs/_tasks/shot/attachments/pic 1.png')
  })

  it('trashes the attachments folder when the task is deleted', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Imgs', 'Projects')
    const task = await addNamed(store, project, 'Shot')
    await store.saveTaskAttachment(project, task, 'pic.png', new ArrayBuffer(4))

    await store.deleteTask(project, task.id)

    expect(vault.getAbstractFileByPath('Projects/Imgs/_tasks/shot/attachments/pic.png')).toBeNull()
    expect(vault.getAbstractFileByPath('Projects/Imgs/_tasks/shot')).toBeNull()
  })

  it('moves the attachments folder when the task is renamed', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Imgs', 'Projects')
    const task = await addNamed(store, project, 'Shot')
    await store.saveTaskAttachment(project, task, 'pic.png', new ArrayBuffer(4))

    await store.updateTask(project, task.id, { title: 'Photo' })

    expect(vault.getAbstractFileByPath('Projects/Imgs/_tasks/shot/attachments/pic.png')).toBeNull()
    expect(vault.getAbstractFileByPath('Projects/Imgs/_tasks/photo/attachments/pic.png')).not.toBeNull()
  })

  it('moves the attachments folder when the task is archived and back when unarchived', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Imgs', 'Projects')
    const task = await addNamed(store, project, 'Shot')
    await store.saveTaskAttachment(project, task, 'pic.png', new ArrayBuffer(4))

    await store.archiveTask(project, task.id)
    expect(vault.getAbstractFileByPath('Projects/Imgs/_tasks/shot/attachments/pic.png')).toBeNull()
    expect(vault.getAbstractFileByPath('Projects/Imgs/_tasks/Archive/shot/attachments/pic.png')).not.toBeNull()

    await store.unarchiveTask(project, task.id)
    expect(vault.getAbstractFileByPath('Projects/Imgs/_tasks/Archive/shot/attachments/pic.png')).toBeNull()
    expect(vault.getAbstractFileByPath('Projects/Imgs/_tasks/shot/attachments/pic.png')).not.toBeNull()
  })
})

describe('ProjectStore archiving', () => {
  it('archives the whole subtree when a parent is archived', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Tree', 'Projects')
    const parent = await addNamed(store, project, 'Parent')
    const child = await addNamed(store, project, 'Child', parent.id)
    const grandchild = await addNamed(store, project, 'Grandchild', child.id)

    await store.archiveTask(project, parent.id)

    for (const task of [parent, child, grandchild]) {
      expect(task.archived).toBe(true)
      expect(task.filePath).toMatch(/^Projects\/Tree\/_tasks\/Archive\//)
      expect(vault.getAbstractFileByPath(expectDefined(task.filePath))).not.toBeNull()
    }
  })

  it('unarchives the whole subtree when a parent is unarchived', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Tree', 'Projects')
    const parent = await addNamed(store, project, 'Parent')
    const child = await addNamed(store, project, 'Child', parent.id)

    await store.archiveTask(project, parent.id)
    await store.unarchiveTask(project, parent.id)

    for (const task of [parent, child]) {
      expect(task.archived).toBe(false)
      expect(task.filePath).toBe(`Projects/Tree/_tasks/${task.title.toLowerCase()}.md`)
      expect(vault.getAbstractFileByPath(expectDefined(task.filePath))).not.toBeNull()
    }
  })

  it('archives several tasks in one save', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Tree', 'Projects')
    const first = await addNamed(store, project, 'First')
    const second = await addNamed(store, project, 'Second')
    const child = await addNamed(store, project, 'Child', second.id)
    const projectWrites = vault.modifyCount.get(project.filePath) ?? 0

    await store.archiveTasks(project, [first.id, second.id])

    for (const task of [first, second, child]) {
      expect(task.archived).toBe(true)
      expect(vault.getAbstractFileByPath(expectDefined(task.filePath))).not.toBeNull()
    }
    expect((vault.modifyCount.get(project.filePath) ?? 0) - projectWrites).toBe(1)
  })

  it('leaves an already archived subtask in place when its parent is archived', async () => {
    const { store } = newStore()
    const project = await store.createProject('Tree', 'Projects')
    const parent = await addNamed(store, project, 'Parent')
    const child = await addNamed(store, project, 'Child', parent.id)

    await store.archiveTask(project, child.id)
    await store.archiveTask(project, parent.id)

    expect(child.archived).toBe(true)
    expect(child.filePath).toBe('Projects/Tree/_tasks/Archive/child.md')
  })
})

describe('ProjectStore metadataCache fast path', () => {
  function stubTaskCache(app: App, path: string, fm: Record<string, unknown>): void {
    const cache = (app as unknown as { metadataCache: { getFileCache: (f: TFile) => unknown } }).metadataCache
    cache.getFileCache = (f: TFile) => (f.path === path ? { frontmatter: fm } : null)
  }

  it('skips the disk read when metadataCache has the task frontmatter', async () => {
    const { store, vault, app } = newStore()
    const project = await store.createProject('Cache', 'Projects')
    const task = await addNamed(store, project, 'cached task')
    const taskPath = expectDefined(task.filePath)

    stubTaskCache(app, taskPath, { 'pm-task': true, id: task.id, title: 'cached task' })

    // Strip the file so a real read would throw — proving the cache path didn't read.
    const f = vault.getAbstractFileByPath(taskPath)
    if (!(f instanceof TFile)) throw new Error('task file missing')
    await vault.trashFile(f)
    vault.resetCounts()

    const stub = new TFile()
    stub.path = taskPath
    stub.basename = 'cached task'
    const result = await store.loadTaskFile(stub)
    expect(result.task?.id).toBe(task.id)
    expect(result.task?.description).toBe('')
  })

  it('loadTaskBody pulls the description from disk on demand', async () => {
    const { store, vault, app } = newStore()
    const project = await store.createProject('Body', 'Projects')
    const task = await addNamed(store, project, 'task')
    await store.updateTask(project, task.id, { description: 'real description' })
    const taskPath = expectDefined(task.filePath)

    // Reload through a fresh store with cache hits — task arrives unhydrated.
    stubTaskCache(app, taskPath, {
      'pm-task': true,
      id: task.id,
      title: 'task',
      projectId: project.id
    })
    const store2 = new ProjectStore(app, () => SETTINGS)
    const projectFile = vault.getAbstractFileByPath(project.filePath)
    if (!(projectFile instanceof TFile)) throw new Error('project file missing')
    const reloaded = await store2.loadProject(projectFile)
    if (!reloaded) throw new Error('reload failed')
    const reloadedTask = reloaded.tasks[0]
    expect(reloadedTask.description).toBe('')

    await store2.loadTaskBody(reloadedTask)
    expect(reloadedTask.description).toBe('real description')
  })

  it('an fm-only save on a cache-loaded task preserves the on-disk description', async () => {
    const { store, vault, app } = newStore()
    const project = await store.createProject('Preserve', 'Projects')
    const task = await addNamed(store, project, 'preserve me')
    await store.updateTask(project, task.id, { description: 'keep this' })
    const taskPath = expectDefined(task.filePath)

    stubTaskCache(app, taskPath, {
      'pm-task': true,
      id: task.id,
      title: 'preserve me',
      projectId: project.id
    })
    const store2 = new ProjectStore(app, () => SETTINGS)
    const projectFile = vault.getAbstractFileByPath(project.filePath)
    if (!(projectFile instanceof TFile)) throw new Error('project file missing')
    const reloaded = await store2.loadProject(projectFile)
    if (!reloaded) throw new Error('reload failed')
    const reloadedTask = reloaded.tasks[0]

    // priority is frontmatter-only — the body must not be touched.
    await store2.updateTask(reloaded, reloadedTask.id, { priority: 'high' })

    const file = vault.getAbstractFileByPath(taskPath)
    if (!(file instanceof TFile)) throw new Error('task file gone')
    const content = await vault.cachedRead(file)
    expect(content).toContain('keep this')
  })

  it('a description edit on a cache-loaded task writes the new body atomically', async () => {
    const { store, vault, app } = newStore()
    const project = await store.createProject('Edit', 'Projects')
    const task = await addNamed(store, project, 'editable')
    await store.updateTask(project, task.id, { description: 'before' })
    const taskPath = expectDefined(task.filePath)

    stubTaskCache(app, taskPath, {
      'pm-task': true,
      id: task.id,
      title: 'editable',
      projectId: project.id
    })
    const store2 = new ProjectStore(app, () => SETTINGS)
    const projectFile = vault.getAbstractFileByPath(project.filePath)
    if (!(projectFile instanceof TFile)) throw new Error('project file missing')
    const reloaded = await store2.loadProject(projectFile)
    if (!reloaded) throw new Error('reload failed')
    const reloadedTask = reloaded.tasks[0]

    await store2.updateTask(reloaded, reloadedTask.id, { description: 'after' })

    const file = vault.getAbstractFileByPath(taskPath)
    if (!(file instanceof TFile)) throw new Error('task file gone')
    const content = await vault.cachedRead(file)
    expect(content).toContain('after')
    expect(content).not.toContain('before')
  })
})

describe('ProjectStore task index', () => {
  it('matches a freshly rebuilt index after a sequence of mutations', async () => {
    const { store } = newStore()
    const project = await store.createProject('Idx', 'Projects')
    const a = await addNamed(store, project, 'Alpha')
    const b = await addNamed(store, project, 'Beta')
    const c = await addNamed(store, project, 'Gamma', a.id)
    await store.updateTask(project, b.id, { title: 'Beta renamed' })
    await store.moveTask(project, c.id, b.id)
    const d = await addNamed(store, project, 'Delta')
    await store.duplicateTask(project, a.id, true)
    await store.deleteTask(project, d.id)

    const fresh = buildTaskIndex(project.tasks)
    expect(project.taskIndex.size).toBe(fresh.size)
    for (const [id, entry] of fresh) {
      expect(project.taskIndex.get(id)?.parentId).toBe(entry.parentId)
      expect(project.taskIndex.get(id)?.task).toBe(entry.task)
    }
  })

  it('duplicates a task with subtasks without colliding on filenames', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Dup', 'Projects')
    const parent = await addNamed(store, project, 'Parent')
    await addNamed(store, project, 'subtask', parent.id)

    const copy = await store.duplicateTask(project, parent.id, true)
    expect(copy).not.toBeNull()

    const paths = flattenTasks(project.tasks).map((f) => f.task.filePath)
    expect(new Set(paths).size).toBe(paths.length)
    for (const p of paths) {
      expect(p).toBeTruthy()
      expect(vault.getAbstractFileByPath(expectDefined(p))).toBeInstanceOf(TFile)
    }
  })

  it('disambiguates the copy title when the same task is duplicated twice', async () => {
    const { store } = newStore()
    const project = await store.createProject('Dup2', 'Projects')
    const task = await addNamed(store, project, 'Task')

    const first = await store.duplicateTask(project, task.id, false)
    const second = await store.duplicateTask(project, task.id, false)

    expect(first?.title).toBe('Task (copy)')
    expect(second?.title).toBe('Task (copy 2)')
  })

  it('counts up instead of stacking suffixes when a copy is duplicated', async () => {
    const { store } = newStore()
    const project = await store.createProject('Dup4', 'Projects')
    const task = await addNamed(store, project, 'Task')

    const first = expectDefined(await store.duplicateTask(project, task.id, false))
    const second = await store.duplicateTask(project, first.id, false)
    const third = await store.duplicateTask(project, second?.id ?? '', false)

    expect(first.title).toBe('Task (copy)')
    expect(second?.title).toBe('Task (copy 2)')
    expect(third?.title).toBe('Task (copy 3)')
  })

  it('survives a reload: rebuilt index after load matches the in-memory tree', async () => {
    const { store, vault, app } = newStore()
    const project = await store.createProject('Reload', 'Projects')
    const a = await addNamed(store, project, 'Alpha')
    await addNamed(store, project, 'Child', a.id)
    await addNamed(store, project, 'Beta')

    const store2 = new ProjectStore(app, () => SETTINGS)
    const file = vault.getAbstractFileByPath(project.filePath)
    if (!(file instanceof TFile)) throw new Error('missing file')
    const reloaded = await store2.loadProject(file)
    if (!reloaded) throw new Error('reload failed')

    const fresh = buildTaskIndex(reloaded.tasks)
    expect(reloaded.taskIndex.size).toBe(fresh.size)
    for (const [id, entry] of fresh) {
      expect(reloaded.taskIndex.get(id)?.parentId).toBe(entry.parentId)
    }
  })
})

describe('ProjectStore editor subtask save', () => {
  const reload = async (app: App, vault: FakeVault, path: string): Promise<Project> => {
    const file = vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) throw new Error('missing file')
    return expectDefined(await new ProjectStore(app, () => SETTINGS).loadProject(file))
  }

  it('persists a subtask added through updateTask (the task editor save path)', async () => {
    const { store, vault, app } = newStore()
    const project = await store.createProject('Editor', 'Projects')
    const parent = await addNamed(store, project, 'Parent')

    // The editor edits a deep clone and saves the whole task back.
    const edited = JSON.parse(JSON.stringify(parent)) as Task
    edited.subtasks.push(makeTask({ title: 'New sub', type: 'subtask' }))
    await store.updateTask(project, parent.id, edited)

    const sub = expectDefined(flattenTasks(project.tasks).find((f) => f.task.title === 'New sub')).task
    expect(sub.filePath).toBeTruthy()
    expect(vault.getAbstractFileByPath(expectDefined(sub.filePath))).toBeInstanceOf(TFile)

    const reloaded = await reload(app, vault, project.filePath)
    expect(
      flattenTasks(reloaded.tasks)
        .map((f) => f.task.title)
        .sort()
    ).toEqual(['New sub', 'Parent'])
  })

  it('renames one subtask and trashes another removed in the editor', async () => {
    const { store, vault, app } = newStore()
    const project = await store.createProject('Editor', 'Projects')
    const parent = await addNamed(store, project, 'Parent')
    await addNamed(store, project, 'Alpha', parent.id)
    const beta = await addNamed(store, project, 'Beta', parent.id)
    const betaPath = expectDefined(beta.filePath)

    const live = expectDefined(flattenTasks(project.tasks).find((f) => f.task.id === parent.id)).task
    const edited = JSON.parse(JSON.stringify(live)) as Task
    edited.subtasks = edited.subtasks.filter((s) => s.title !== 'Beta')
    edited.subtasks[0].title = 'Alpha renamed'
    await store.updateTask(project, parent.id, edited)

    expect(vault.getAbstractFileByPath(betaPath)).toBeNull()
    const reloaded = await reload(app, vault, project.filePath)
    expect(
      flattenTasks(reloaded.tasks)
        .map((f) => f.task.title)
        .sort()
    ).toEqual(['Alpha renamed', 'Parent'])
  })
})

describe('ProjectStore duplicate long titles', () => {
  it('duplicates a long-titled task without hanging and keeps filenames unique', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Dup3', 'Projects')
    const longTitle = 'This is a very long task title that comfortably exceeds the sixty character filename slug cap'
    const parent = await addNamed(store, project, longTitle)
    await addNamed(store, project, 'subtask', parent.id)

    // The base is trimmed so the "(copy N)" suffix survives the slug cap and both
    // copies get distinct titles and files.
    expect(await store.duplicateTask(project, parent.id, true)).not.toBeNull()
    expect(await store.duplicateTask(project, parent.id, true)).not.toBeNull()

    const paths = flattenTasks(project.tasks).map((f) => f.task.filePath)
    expect(new Set(paths).size).toBe(paths.length)
    for (const p of paths) {
      expect(vault.getAbstractFileByPath(expectDefined(p))).toBeInstanceOf(TFile)
    }
  })
})

describe('ProjectStore concurrent-save race', () => {
  it('does not lose markDirty calls that fire during an in-flight save', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Race', 'Projects')
    const a = await addNamed(store, project, 'Alpha')
    const b = await addNamed(store, project, 'Beta')
    const aOldPath = expectDefined(a.filePath)
    const bOldPath = expectDefined(b.filePath)
    vault.resetCounts()

    // The second save chains behind the first in the queue, so its markDirty calls
    // must survive the first save's dirty-set drain.
    const first = store.updateTask(project, a.id, { title: 'A new' })
    const second = store.updateTask(project, b.id, { title: 'B new' })
    await Promise.all([first, second])

    expect(vault.getAbstractFileByPath('Projects/Race/_tasks/a-new.md')).not.toBeNull()
    expect(vault.getAbstractFileByPath('Projects/Race/_tasks/b-new.md')).not.toBeNull()
    expect(vault.getAbstractFileByPath(aOldPath)).toBeNull()
    expect(vault.getAbstractFileByPath(bOldPath)).toBeNull()
  })
})

describe('ProjectStore bulk mutators', () => {
  it('updateTasks with a function patch writes only the patched task files', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Bulk', 'Projects')
    const a = await addNamed(store, project, 'alpha')
    const b = await addNamed(store, project, 'beta')
    await store.updateTask(project, b.id, { assignees: ['sam'] })
    vault.resetCounts()

    await store.updateTasks(project, [a.id, b.id], (t) =>
      t.assignees.includes('sam') ? null : { assignees: [...t.assignees, 'sam'] }
    )

    expect(a.assignees).toEqual(['sam'])
    expect(vault.modifyCount.get(expectDefined(a.filePath))).toBe(1)
    expect(vault.modifyCount.get(expectDefined(b.filePath))).toBeUndefined()
    const file = vault.getAbstractFileByPath(expectDefined(a.filePath))
    if (!(file instanceof TFile)) throw new Error('task file missing')
    expect(await vault.cachedRead(file)).toContain('sam')
  })

  it('reorderTask persists sibling order through the parent file only', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Order', 'Projects')
    const parent = await addNamed(store, project, 'parent')
    const one = await addNamed(store, project, 'one', parent.id)
    const two = await addNamed(store, project, 'two', parent.id)
    vault.resetCounts()

    await store.reorderTask(project, two.id, one.id, 'before')

    expect(parent.subtasks.map((t) => t.id)).toEqual([two.id, one.id])
    expect(vault.modifyCount.get(expectDefined(parent.filePath))).toBe(1)
    expect(vault.modifyCount.get(expectDefined(one.filePath))).toBeUndefined()
    expect(vault.modifyCount.get(expectDefined(two.filePath))).toBeUndefined()
    const file = vault.getAbstractFileByPath(expectDefined(parent.filePath))
    if (!(file instanceof TFile)) throw new Error('parent file missing')
    const content = await vault.cachedRead(file)
    expect(content.indexOf(two.id)).toBeLessThan(content.indexOf(one.id))
  })

  it('writes tasks that have no file yet even when nothing marked them dirty', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Net', 'Projects')
    const rogue = makeTask({ title: 'rogue' })
    project.tasks.push(rogue)
    project.taskIndex.set(rogue.id, { task: rogue, parentId: null })

    await store.saveProject(project)

    expect(rogue.filePath).toBeDefined()
    expect(vault.getAbstractFileByPath(expectDefined(rogue.filePath))).not.toBeNull()
  })
})

describe('ProjectStore.moveTaskToProject', () => {
  it('moves the task and its subtasks into the target project, keeping their ids', async () => {
    const { store, vault, app } = newStore()
    const from = await store.createProject('From', 'Projects')
    const to = await store.createProject('To', 'Work')
    const parent = await addNamed(store, from, 'Parent')
    const child = await addNamed(store, from, 'Child', parent.id)

    await store.moveTaskToProject(from, to, parent.id)

    expect(from.tasks).toHaveLength(0)
    expect(to.tasks.map((t) => t.id)).toEqual([parent.id])
    expect(to.tasks[0].subtasks.map((t) => t.id)).toEqual([child.id])
    expect(vault.getAbstractFileByPath('Projects/From/_tasks/parent.md')).toBeNull()
    expect(vault.getAbstractFileByPath('Work/To/_tasks/parent.md')).not.toBeNull()
    expect(vault.getAbstractFileByPath('Work/To/_tasks/child.md')).not.toBeNull()

    const store2 = new ProjectStore(app, () => SETTINGS)
    const reloaded = await store2.loadProject(fileAt(app, to.filePath))
    expect(flattenTasks(reloaded?.tasks ?? []).map((f) => f.task.id)).toEqual([parent.id, child.id])
  })

  it('writes the target project id into the moved task file', async () => {
    const { store, app } = newStore()
    const from = await store.createProject('From', 'Projects')
    const to = await store.createProject('To', 'Work')
    const task = await addNamed(store, from, 'Solo')

    await store.moveTaskToProject(from, to, task.id)

    const content = await app.vault.cachedRead(fileAt(app, 'Work/To/_tasks/solo.md'))
    expect(content).toContain(`projectId: "${to.id}"`)
  })

  it('does nothing when the source and target are the same project', async () => {
    const { store } = newStore()
    const project = await store.createProject('Same', 'Projects')
    const task = await addNamed(store, project, 'Stay')

    await store.moveTaskToProject(project, project, task.id)

    expect(project.tasks.map((t) => t.id)).toEqual([task.id])
  })
})

describe('ProjectStore project cache', () => {
  it('returns the cached instance on repeated loads', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Cached', 'Projects')
    await addNamed(store, project, 'task')
    const file = vault.getAbstractFileByPath(project.filePath)
    if (!(file instanceof TFile)) throw new Error('project file missing')

    const first = await store.loadProject(file)
    const second = await store.loadProject(file)

    expect(first).toBe(project)
    expect(second).toBe(first)
  })
})

describe('ProjectStore.importNoteAsTask', () => {
  async function importInto(handling: 'move' | 'copy') {
    const { store, vault, app } = newStore()
    const project = await store.createProject('Import', 'Projects')
    const note = await vault.create('Notes/Idea.md', 'the note body')
    const result = await store.importNoteAsTask(project, note, {
      status: 'in-progress',
      priority: 'high',
      handling
    })
    return { store, vault, app, project, result }
  }

  it('copies a note into the tasks folder and keeps the original', async () => {
    const { vault, result } = await importInto('copy')
    expect(result).toBe('imported')
    expect(vault.getAbstractFileByPath('Notes/Idea.md')).toBeInstanceOf(TFile)

    const created = vault.getAbstractFileByPath('Projects/Import/_tasks/idea.md')
    if (!(created instanceof TFile)) throw new Error('imported task file missing')
    const content = await vault.read(created)
    expect(content).toContain('pm-task: true')
    expect(content).toContain('status: "in-progress"')
    expect(content).toContain('priority: "high"')
    expect(content).toContain('the note body')
  })

  it('moves a note into the tasks folder', async () => {
    const { vault, result } = await importInto('move')
    expect(result).toBe('imported')
    expect(vault.getAbstractFileByPath('Notes/Idea.md')).toBeNull()

    const moved = vault.getAbstractFileByPath('Projects/Import/_tasks/idea.md')
    if (!(moved instanceof TFile)) throw new Error('imported task file missing')
    const content = await vault.read(moved)
    expect(content).toContain('pm-task: true')
    expect(content).toContain('the note body')
  })

  it('imported tasks appear as top-level tasks on the next project load', async () => {
    const { vault, app, project } = await importInto('move')
    const store2 = new ProjectStore(app, () => SETTINGS)
    const file = vault.getAbstractFileByPath(project.filePath)
    if (!(file instanceof TFile)) throw new Error('project file missing')
    const reloaded = expectDefined(await store2.loadProject(file))
    expect(reloaded.tasks.map((t) => t.title)).toContain('Idea')
  })

  it('skips notes that are already tasks', async () => {
    const { store, vault, project } = await importInto('copy')
    const existing = vault.getAbstractFileByPath('Projects/Import/_tasks/idea.md')
    if (!(existing instanceof TFile)) throw new Error('imported task file missing')
    const before = await vault.read(existing)

    const result = await store.importNoteAsTask(project, existing, {
      status: 'todo',
      priority: 'low',
      handling: 'move'
    })
    expect(result).toBe('skipped')
    expect(await vault.read(existing)).toBe(before)
  })
})

describe('ProjectStore.importTaskForest', () => {
  it('writes a parent/child forest that reloads as a tree with dependencies', async () => {
    const { store, vault, app } = newStore()
    const project = await store.createProject('Forest', 'Projects')
    const parentSource = await vault.create('Notes/Parent.md', 'parent body')
    const childSource = await vault.create('Notes/Child.md', 'child body')

    const child = makeTask({ title: 'Child', type: 'subtask' })
    const parent = makeTask({ title: 'Parent', subtasks: [child] })
    child.dependencies = [parent.id]
    const sources = new Map([
      [parent.id, parentSource],
      [child.id, childSource]
    ])

    const count = await store.importTaskForest(project, [parent], sources, 'move')
    expect(count).toBe(2)
    expect(vault.getAbstractFileByPath('Notes/Parent.md')).toBeNull()

    const store2 = new ProjectStore(app, () => SETTINGS)
    const file = vault.getAbstractFileByPath(project.filePath)
    if (!(file instanceof TFile)) throw new Error('project file missing')
    const reloaded = expectDefined(await store2.loadProject(file))
    const top = reloaded.tasks.find((t) => t.title === 'Parent')
    expect(expectDefined(top).subtasks.map((t) => t.title)).toEqual(['Child'])
    expect(expectDefined(top).subtasks[0].dependencies).toEqual([parent.id])
    expect(expectDefined(top).description).toBe('parent body')
  })

  it('places archived tasks in the Archive subfolder', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Arch', 'Projects')
    const source = await vault.create('Notes/Old.md', 'old body')
    const task = makeTask({ title: 'Old', archived: true })

    await store.importTaskForest(project, [task], new Map([[task.id, source]]), 'copy')
    expect(vault.getAbstractFileByPath('Projects/Arch/_tasks/Archive/old.md')).toBeInstanceOf(TFile)
    expect(vault.getAbstractFileByPath('Notes/Old.md')).toBeInstanceOf(TFile)
  })
})

describe('per-project config', () => {
  it('round-trips the config overrides through the project file', async () => {
    const { store, vault, app } = newStore()
    const project = await store.createProject('Custom', 'Projects')
    project.config = {
      statuses: [
        { id: 'idea', label: 'Idea', color: '#888888', icon: '', complete: false },
        { id: 'shipped', label: 'Shipped', color: '#00aa00', icon: '', complete: true }
      ],
      priorities: [
        { id: 'urgent', label: 'Urgent', color: '#ff0000', icon: '' },
        { id: 'later', label: 'Later', color: '#888888', icon: '' }
      ],
      priorityIcons: 'signal',
      defaultView: 'kanban',
      autoSchedule: false
    }
    await store.saveProject(project)

    const store2 = new ProjectStore(app, () => SETTINGS)
    const file = vault.getAbstractFileByPath(project.filePath)
    if (!(file instanceof TFile)) throw new Error('project file missing')
    const reloaded = expectDefined(await store2.loadProject(file))
    expect(reloaded.config).toEqual(project.config)
  })

  it('omits the frontmatter key when the project overrides nothing', async () => {
    const { store, vault, app } = newStore()
    const project = await store.createProject('Inherit', 'Projects')
    await store.saveProject(project)

    const store2 = new ProjectStore(app, () => SETTINGS)
    const file = vault.getAbstractFileByPath(project.filePath)
    if (!(file instanceof TFile)) throw new Error('project file missing')
    expect(await vault.read(file)).not.toContain('config:')
    const reloaded = expectDefined(await store2.loadProject(file))
    expect(reloaded.config).toBeUndefined()
  })

  it('stamps completion using the project-defined complete flag', async () => {
    const { store } = newStore()
    const project = await store.createProject('Flags', 'Projects')
    project.config = {
      statuses: [
        { id: 'idea', label: 'Idea', color: '#888888', icon: '', complete: false },
        { id: 'shipped', label: 'Shipped', color: '#00aa00', icon: '', complete: true }
      ]
    }
    const task = await addNamed(store, project, 'Ship it')
    await store.updateTask(project, task.id, { status: 'shipped' })
    expect(expectDefined(findTask(project.tasks, task.id)).completed).not.toBe('')
  })

  it('skips auto-scheduling when the project turns it off', async () => {
    const { store } = newStore()
    const project = await store.createProject('NoSched', 'Projects')
    const a = await addNamed(store, project, 'First')
    const b = await addNamed(store, project, 'Second')
    await store.updateTask(project, a.id, { start: '2026-07-06', due: '2026-07-10' })
    await store.updateTask(project, b.id, { start: '2026-07-01', due: '2026-07-02', dependencies: [a.id] })

    project.config = { autoSchedule: false }
    expect(await store.scheduleAfterChange(project, a.id)).toBe(0)

    project.config = undefined
    expect(await store.scheduleAfterChange(project, a.id)).toBeGreaterThan(0)
  })
})

describe('ProjectStore cross-project scheduling', () => {
  it('pushes dependents in other projects when a predecessor moves', async () => {
    const { store, index } = newIndexedStore()
    const upstream = await store.createProject('Upstream', 'Projects')
    const middle = await store.createProject('Middle', 'Projects')
    const downstream = await store.createProject('Downstream', 'Projects')

    const a = await addNamed(store, upstream, 'Build')
    const b = await addNamed(store, middle, 'Review')
    const c = await addNamed(store, downstream, 'Launch')
    await store.updateTask(upstream, a.id, { start: '2026-07-01', due: '2026-07-03' })
    await store.updateTask(middle, b.id, { start: '2026-07-04', due: '2026-07-05', dependencies: [a.id] })
    await store.updateTask(downstream, c.id, { start: '2026-07-06', due: '2026-07-06', dependencies: [b.id] })
    index.build()

    await store.updateTask(upstream, a.id, { start: '2026-07-08', due: '2026-07-10' })
    expect(await store.scheduleAfterChange(upstream, a.id)).toBe(2)

    expect(expectDefined(findTask(middle.tasks, b.id)).start).toBe('2026-07-11')
    expect(expectDefined(findTask(middle.tasks, b.id)).due).toBe('2026-07-12')
    expect(expectDefined(findTask(downstream.tasks, c.id)).start).toBe('2026-07-13')
  })

  it('leaves a project that turns auto-scheduling off alone but keeps following the chain', async () => {
    const { store, index } = newIndexedStore()
    const upstream = await store.createProject('Source', 'Projects')
    const frozen = await store.createProject('Frozen', 'Projects')
    const downstream = await store.createProject('Tail', 'Projects')

    const a = await addNamed(store, upstream, 'Build')
    const b = await addNamed(store, frozen, 'Fixed date')
    const c = await addNamed(store, downstream, 'Launch')
    await store.updateTask(upstream, a.id, { start: '2026-07-01', due: '2026-07-03' })
    await store.updateTask(frozen, b.id, { start: '2026-07-04', due: '2026-07-05', dependencies: [a.id] })
    await store.updateTask(downstream, c.id, { start: '2026-07-06', due: '2026-07-06', dependencies: [a.id] })
    index.build()

    frozen.config = { autoSchedule: false }
    await store.updateTask(upstream, a.id, { start: '2026-07-08', due: '2026-07-10' })
    await store.scheduleAfterChange(upstream, a.id)

    expect(expectDefined(findTask(frozen.tasks, b.id)).start).toBe('2026-07-04')
    expect(expectDefined(findTask(downstream.tasks, c.id)).start).toBe('2026-07-11')
  })

  it('pulls a dependent forward when the blocker finished early under another palette', async () => {
    const { store, index } = newIndexedStore()
    const upstream = await store.createProject('Ships', 'Projects')
    const downstream = await store.createProject('Waits', 'Projects')
    upstream.config = {
      statuses: [
        { id: 'todo', label: 'Todo', color: '#888', icon: 'circle', complete: false },
        { id: 'shipped', label: 'Shipped', color: '#0a0', icon: 'check', complete: true }
      ]
    }
    downstream.config = { pullForwardOnEarlyFinish: true }

    const blocker = await addNamed(store, upstream, 'Blocker')
    const blocked = await addNamed(store, downstream, 'Blocked')
    await store.updateTask(upstream, blocker.id, { start: '2099-06-01', due: '2099-06-10' })
    await store.updateTask(downstream, blocked.id, {
      start: '2099-06-11',
      due: '2099-06-12',
      dependencies: [blocker.id]
    })
    index.build()

    await store.updateTask(upstream, blocker.id, { status: 'shipped', completed: '2099-06-07' })

    expect(expectDefined(findTask(downstream.tasks, blocked.id)).start).toBe('2099-06-08')
    expect(expectDefined(findTask(downstream.tasks, blocked.id)).due).toBe('2099-06-09')
  })

  it('stops rather than looping when the chain closes a cycle across projects', async () => {
    const { store, index } = newIndexedStore()
    const one = await store.createProject('Ping', 'Projects')
    const two = await store.createProject('Pong', 'Projects')

    const a = await addNamed(store, one, 'A')
    const b = await addNamed(store, two, 'B')
    await store.updateTask(one, a.id, { start: '2026-07-01', due: '2026-07-02', dependencies: [b.id] })
    await store.updateTask(two, b.id, { start: '2026-07-03', due: '2026-07-04', dependencies: [a.id] })
    index.build()

    await expect(store.scheduleAfterChange(one, a.id)).resolves.toBeGreaterThan(0)
  })
})

describe('ProjectStore project folders', () => {
  /** The store follows a rename a tick later, so the move needs two turns to land. */
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 3; i++) await new Promise((resolve) => window.setTimeout(resolve, 0))
  }

  const syncedStore = (): ReturnType<typeof newIndexedStore> => {
    const made = newIndexedStore()
    made.store.registerVaultSync({ registerEvent: () => {}, register: () => {} } as unknown as Plugin)
    return made
  }

  it('creates a project in a folder of its own', async () => {
    const { store, app } = newStore()
    const project = await store.createProject('Roadmap', 'Projects')
    const task = await addNamed(store, project, 'Design')

    expect(project.filePath).toBe('Projects/Roadmap/Roadmap.md')
    expect(task.filePath).toBe('Projects/Roadmap/_tasks/design.md')
    expect(app.vault.getAbstractFileByPath('Projects/Roadmap/_tasks/design.md')).toBeInstanceOf(TFile)
  })

  it('moves a project that still sits beside its task folder into its own folder', async () => {
    const { store, app } = newIndexedStore()
    await app.vault.create(
      'Projects/Legacy.md',
      ['---', 'pm-project: true', 'id: p1', 'title: Legacy', 'taskIds: []', '---', ''].join('\n')
    )
    await app.vault.createFolder('Projects/Legacy_tasks')
    await app.vault.create(
      'Projects/Legacy_tasks/first.md',
      ['---', 'pm-task: true', 'id: t1', 'title: First', 'status: todo', '---', ''].join('\n')
    )

    const moved = await store.moveProjectIntoOwnFolder('Projects/Legacy.md')

    expect(moved).toBe('Projects/Legacy/Legacy.md')
    expect(app.vault.getAbstractFileByPath('Projects/Legacy/_tasks/first.md')).toBeInstanceOf(TFile)
    expect(app.vault.getAbstractFileByPath('Projects/Legacy.md')).toBeNull()
    expect(app.vault.getAbstractFileByPath('Projects/Legacy_tasks')).toBeNull()

    const reloaded = await store.loadProjectByPath('Projects/Legacy/Legacy.md')
    expect(flattenTasks(expectDefined(reloaded).tasks).map((f) => f.task.title)).toEqual(['First'])
  })

  it('moves a project sitting at the vault root into a folder beside it', async () => {
    const { store, app } = newIndexedStore()
    await app.vault.create(
      'Stress test.md',
      ['---', 'pm-project: true', 'id: p1', 'title: Stress test', 'taskIds: []', '---', ''].join('\n')
    )

    const moved = await store.moveProjectIntoOwnFolder('Stress test.md')

    expect(moved).toBe('Stress test/Stress test.md')
    expect(app.vault.getAbstractFileByPath('Stress test/Stress test.md')).toBeInstanceOf(TFile)
  })

  it('leaves a project that already owns its folder alone', async () => {
    const { store } = newStore()
    const project = await store.createProject('Roadmap', 'Projects')
    await expect(store.moveProjectIntoOwnFolder(project.filePath)).resolves.toBeNull()
  })

  it('trashes the whole folder when a project is deleted', async () => {
    const { store, app } = newStore()
    const project = await store.createProject('Doomed', 'Projects')
    await addNamed(store, project, 'Card')

    await store.deleteProject(project)

    expect(app.vault.getAbstractFileByPath('Projects/Doomed')).toBeNull()
  })

  it('spares a sub-project nested in the folder of a deleted project', async () => {
    const { store, index, app } = newIndexedStore()
    const parent = await store.createProject('Parent', 'Projects')
    const child = await store.createProject('Child', 'Projects/Parent')
    index.build()

    await store.deleteProject(parent)

    expect(app.vault.getAbstractFileByPath(parent.filePath)).toBeNull()
    expect(app.vault.getAbstractFileByPath('Projects/Parent/_tasks')).toBeNull()
    expect(app.vault.getAbstractFileByPath(child.filePath)).toBeInstanceOf(TFile)
  })

  it('renames the folder when the project note is renamed', async () => {
    const { store, app } = syncedStore()
    const project = await store.createProject('Alpha', 'Projects')
    const task = await addNamed(store, project, 'Card')

    await app.fileManager.renameFile(fileAt(app, project.filePath), 'Projects/Alpha/Beta.md')
    await flush()

    expect(app.vault.getAbstractFileByPath('Projects/Beta/Beta.md')).toBeInstanceOf(TFile)
    expect(project.filePath).toBe('Projects/Beta/Beta.md')
    expect(
      app.vault.getAbstractFileByPath(`Projects/Beta/_tasks/${expectDefined(task.filePath).split('/').pop()}`)
    ).toBeInstanceOf(TFile)
  })

  it('renames the note and its folder when the title is edited', async () => {
    const { store, app } = syncedStore()
    const project = await store.createProject('Alpha', 'Projects')
    const task = await addNamed(store, project, 'Card')

    await store.updateProject(project, { title: 'Beta' })
    await flush()

    expect(project.filePath).toBe('Projects/Beta/Beta.md')
    expect(app.vault.getAbstractFileByPath('Projects/Alpha')).toBeNull()
    const content = await app.vault.cachedRead(fileAt(app, 'Projects/Beta/Beta.md'))
    expect(content).toContain('title: "Beta"')
    expect(
      app.vault.getAbstractFileByPath(`Projects/Beta/_tasks/${expectDefined(task.filePath).split('/').pop()}`)
    ).toBeInstanceOf(TFile)
  })

  it('leaves the note where it is when the new title collides with an existing note', async () => {
    const { store, app } = syncedStore()
    await store.createProject('Beta', 'Projects')
    const project = await store.createProject('Alpha', 'Projects')

    await store.updateProject(project, { title: 'Beta' })
    await flush()

    expect(project.filePath).toBe('Projects/Alpha/Alpha.md')
    expect(project.title).toBe('Beta')
    const content = await app.vault.cachedRead(fileAt(app, 'Projects/Alpha/Alpha.md'))
    expect(content).toContain('title: "Beta"')
  })

  it('keeps a project attached to its tasks when its folder is renamed', async () => {
    const { store, app } = syncedStore()
    const project = await store.createProject('Alpha', 'Projects')
    await addNamed(store, project, 'Card')

    const folder = expectDefined(app.vault.getAbstractFileByPath('Projects/Alpha'))
    await app.vault.rename(folder, 'Projects/Gamma')
    await flush()

    // The note keeps its own name; the folder it sits in is what moved.
    expect(app.vault.getAbstractFileByPath('Projects/Gamma/Alpha.md')).toBeInstanceOf(TFile)
    expect(projectTaskFolder(app, 'Projects/Gamma/Alpha.md')).toBe('Projects/Gamma/_tasks')
    expect(app.vault.getAbstractFileByPath('Projects/Gamma/_tasks/card.md')).toBeInstanceOf(TFile)
  })

  it('leaves the task folder alone when a note renamed inside its project folder never owned its name', async () => {
    const { store, app } = syncedStore()
    await app.vault.create(
      'Projects/Alpha/Loose.md',
      ['---', 'pm-project: true', 'id: p1', 'title: Loose', 'taskIds: []', '---', ''].join('\n')
    )
    await app.vault.createFolder('Projects/Alpha/_tasks')
    await store.loadProjectByPath('Projects/Alpha/Loose.md')

    await app.fileManager.renameFile(fileAt(app, 'Projects/Alpha/Loose.md'), 'Projects/Alpha/Renamed.md')
    await flush()

    expect(app.vault.getAbstractFileByPath('Projects/Alpha/_tasks')).toBeInstanceOf(TFolder)
    expect(app.vault.getAbstractFileByPath('Projects/Alpha/Renamed_tasks')).toBeNull()
  })

  it('takes the task folder along when a project note leaves its folder', async () => {
    const { store, app } = syncedStore()
    const project = await store.createProject('Alpha', 'Projects')
    await addNamed(store, project, 'Card')

    await app.fileManager.renameFile(fileAt(app, project.filePath), 'Work/Alpha.md')
    await flush()

    expect(app.vault.getAbstractFileByPath('Work/Alpha_tasks/card.md')).toBeInstanceOf(TFile)
  })
})

describe('ProjectStore.reassignIds', () => {
  it('gives listed tasks fresh ids and remaps internal dependencies, in memory and on disk', async () => {
    const { store, app } = newStore()
    const project = await store.createProject('Roadmap', 'Projects')
    const alpha = await addNamed(store, project, 'Alpha')
    const beta = await addNamed(store, project, 'Beta')
    await store.updateTask(project, beta.id, { dependencies: [alpha.id] })
    const oldAlphaId = alpha.id
    const oldBetaId = beta.id

    await store.reassignIds(project, [oldAlphaId, oldBetaId], false)

    expect(findTask(project.tasks, oldAlphaId)).toBeNull()
    expect(findTask(project.tasks, oldBetaId)).toBeNull()
    const freshAlpha = expectDefined(project.tasks.find((t) => t.title === 'Alpha'))
    const freshBeta = expectDefined(project.tasks.find((t) => t.title === 'Beta'))
    expect(freshBeta.dependencies).toEqual([freshAlpha.id])
    expect(expectDefined(project.taskIndex.get(freshAlpha.id)).task).toBe(freshAlpha)

    const alphaContent = await app.vault.cachedRead(fileAt(app, expectDefined(freshAlpha.filePath)))
    expect(alphaContent).toContain(freshAlpha.id)
    expect(alphaContent).not.toContain(oldAlphaId)
    const projectContent = await app.vault.cachedRead(fileAt(app, project.filePath))
    expect(projectContent).toContain(freshAlpha.id)
    expect(projectContent).not.toContain(oldAlphaId)
  })

  it('keeps a dependency on an id the project does not own', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Roadmap', 'Projects')
    const alpha = await addNamed(store, project, 'Alpha')
    await store.updateTask(project, alpha.id, { dependencies: ['elsewhere1'] })

    vault.resetCounts()
    await store.reassignIds(project, ['elsewhere1'], false)

    expect(expectDefined(findTask(project.tasks, alpha.id)).dependencies).toEqual(['elsewhere1'])
    expect(vault.modifyCount.size).toBe(0)
  })

  it('writes a fresh project id into the project note and every task note', async () => {
    const { store, app } = newStore()
    const project = await store.createProject('Roadmap', 'Projects')
    const alpha = await addNamed(store, project, 'Alpha')
    const oldProjectId = project.id

    await store.reassignIds(project, [], true)

    expect(project.id).not.toBe(oldProjectId)
    const projectContent = await app.vault.cachedRead(fileAt(app, project.filePath))
    expect(projectContent).toContain(project.id)
    const alphaContent = await app.vault.cachedRead(fileAt(app, expectDefined(alpha.filePath)))
    expect(alphaContent).toContain(project.id)
    expect(alphaContent).not.toContain(oldProjectId)
  })
})

describe('ProjectStore.duplicateProject', () => {
  it('clones every task with fresh ids and remaps dependencies between roots', async () => {
    const { store, app } = newStore()
    const source = await store.createProject('Roadmap', 'Projects')
    const alpha = await addNamed(store, source, 'Alpha')
    const beta = await addNamed(store, source, 'Beta')
    await store.updateTask(source, beta.id, { dependencies: [alpha.id, 'elsewhere1'] })

    const copy = await store.duplicateProject(source, 'Roadmap copy')

    expect(copy.filePath).toBe('Projects/Roadmap copy/Roadmap copy.md')
    expect(copy.id).not.toBe(source.id)
    const copyAlpha = expectDefined(copy.tasks.find((t) => t.title === 'Alpha'))
    const copyBeta = expectDefined(copy.tasks.find((t) => t.title === 'Beta'))
    expect(copyAlpha.id).not.toBe(alpha.id)
    expect(copyBeta.dependencies).toEqual([copyAlpha.id, 'elsewhere1'])
    expect(fileAt(app, 'Projects/Roadmap copy/_tasks/alpha.md')).toBeInstanceOf(TFile)

    expect(source.tasks.map((t) => t.id)).toEqual([alpha.id, beta.id])
    expect(expectDefined(findTask(source.tasks, beta.id)).dependencies).toEqual([alpha.id, 'elsewhere1'])
  })

  it('carries the project settings, people, and descriptions over', async () => {
    const { store, app } = newStore()
    const source = await store.createProject('Roadmap', 'Projects')
    source.teamMembers = ['Jane']
    source.config = { defaultView: 'kanban' }
    await store.updateProject(source, { description: 'The plan.' })
    const alpha = await addNamed(store, source, 'Alpha')
    await store.updateTask(source, alpha.id, { description: 'Alpha body.' })

    const copy = await store.duplicateProject(source, 'Roadmap copy')

    expect(copy.teamMembers).toEqual(['Jane'])
    expect(copy.config).toEqual({ defaultView: 'kanban' })
    expect(copy.description).toBe('The plan.')
    const copyAlphaContent = await app.vault.cachedRead(fileAt(app, 'Projects/Roadmap copy/_tasks/alpha.md'))
    expect(copyAlphaContent).toContain('Alpha body.')
  })

  it('refuses a title already taken beside the source', async () => {
    const { store } = newStore()
    const source = await store.createProject('Roadmap', 'Projects')

    await expect(store.duplicateProject(source, 'Roadmap')).rejects.toThrow('already exists')
  })
})

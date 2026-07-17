import type { App } from 'obsidian'
import { TFile } from 'obsidian'
import { describe, expect, it, vi } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../test/fakeVault'
import { DEFAULT_SETTINGS, makeTask, type PMSettings, type Project, type StatusConfig, type Task } from '../types'
import { ProjectStore } from './ProjectStore'
import { buildTaskIndex } from './TaskIndex'
import { findTask, flattenTasks } from './TaskTreeOps'
import { parseFrontmatter } from './YamlParser'

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

describe('ProjectStore self-write tracking', () => {
  it('marks the project file as self-written after save', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Self', 'Projects')
    expect(store.consumeSelfWrite(project.filePath)).toBe(true) // creates mark too (cache invalidation peeks them)

    await store.updateTask(project, 'nope', {}) // no-op (id not found)
    // Project file is rewritten on every saveProject, which marks it.
    expect(store.consumeSelfWrite(project.filePath)).toBe(true)
    expect(vault.modifyCount.get(project.filePath)).toBe(1)
  })

  it('marks task file paths as self-written when modified', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('T', 'Projects')
    const task = await addNamed(store, project, 'Solo')
    vault.resetCounts()

    await store.updateTask(project, task.id, { status: 'in-progress' })

    expect(store.consumeSelfWrite(expectDefined(task.filePath))).toBe(true)
    expect(store.consumeSelfWrite(expectDefined(task.filePath))).toBe(false) // single-use
  })

  it('marks both old and new path on title rename (modify new, trash old)', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('R', 'Projects')
    const task = await addNamed(store, project, 'Before')
    const oldPath = expectDefined(task.filePath)
    vault.resetCounts()

    await store.updateTask(project, task.id, { title: 'Renamed' })

    // The new path is created (marked for cache invalidation) and the old
    // path is trashed (marked so the delete listener skips the reload).
    expect(store.consumeSelfWrite(expectDefined(task.filePath))).toBe(true)
    expect(store.consumeSelfWrite(oldPath)).toBe(true)
  })

  it('treats markers older than the window as stale', async () => {
    const { store } = newStore()

    try {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      const project = await store.createProject('Stale', 'Projects')
      vi.setSystemTime(new Date('2026-01-01T00:00:05.001Z')) // > 5s after marker
      expect(store.consumeSelfWrite(project.filePath)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
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

    // Fresh store, same vault. Reload from disk.
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

    // Files exist on disk now.
    expect(vault.getAbstractFileByPath('Projects/Legacy_tasks/first.md')).not.toBeNull()
    expect(vault.getAbstractFileByPath('Projects/Legacy_tasks/second.md')).not.toBeNull()

    // Reload and verify the embedded tasks survived as per-file tasks.
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
    // The task modal saves the whole task as the patch, so `completed` is present
    // and equal to the stored value. Auto-stamping must still fire on the status flip.
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

    // A shared patch object applied to a task that is already done must not carry
    // a stamped date onto the open task in the same call.
    await store.updateTasks(project, [finishing.id, open.id], { priority: 'high' })
    expect(open.completed).toBe('')
  })
})

describe('ProjectStore task attachments', () => {
  it('saves an attachment under the task own attachments folder', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Imgs', 'Projects')
    const task = await addNamed(store, project, 'Shot')

    const file = await store.saveTaskAttachment(project, task, 'pic.png', new ArrayBuffer(4))

    expect(file.path).toBe('Projects/Imgs/Imgs_tasks/shot/attachments/pic.png')
    expect(vault.getAbstractFileByPath('Projects/Imgs/Imgs_tasks/shot/attachments/pic.png')).not.toBeNull()
  })

  it('disambiguates a colliding attachment name', async () => {
    const { store } = newStore()
    const project = await store.createProject('Imgs', 'Projects')
    const task = await addNamed(store, project, 'Shot')

    const first = await store.saveTaskAttachment(project, task, 'pic.png', new ArrayBuffer(4))
    const second = await store.saveTaskAttachment(project, task, 'pic.png', new ArrayBuffer(4))

    expect(first.path).toBe('Projects/Imgs/Imgs_tasks/shot/attachments/pic.png')
    expect(second.path).toBe('Projects/Imgs/Imgs_tasks/shot/attachments/pic 1.png')
  })

  it('trashes the attachments folder when the task is deleted', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Imgs', 'Projects')
    const task = await addNamed(store, project, 'Shot')
    await store.saveTaskAttachment(project, task, 'pic.png', new ArrayBuffer(4))

    await store.deleteTask(project, task.id)

    expect(vault.getAbstractFileByPath('Projects/Imgs/Imgs_tasks/shot/attachments/pic.png')).toBeNull()
    expect(vault.getAbstractFileByPath('Projects/Imgs/Imgs_tasks/shot')).toBeNull()
  })

  it('moves the attachments folder when the task is renamed', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Imgs', 'Projects')
    const task = await addNamed(store, project, 'Shot')
    await store.saveTaskAttachment(project, task, 'pic.png', new ArrayBuffer(4))

    await store.updateTask(project, task.id, { title: 'Photo' })

    expect(vault.getAbstractFileByPath('Projects/Imgs/Imgs_tasks/shot/attachments/pic.png')).toBeNull()
    expect(vault.getAbstractFileByPath('Projects/Imgs/Imgs_tasks/photo/attachments/pic.png')).not.toBeNull()
  })

  it('moves the attachments folder when the task is archived and back when unarchived', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Imgs', 'Projects')
    const task = await addNamed(store, project, 'Shot')
    await store.saveTaskAttachment(project, task, 'pic.png', new ArrayBuffer(4))

    await store.archiveTask(project, task.id)
    expect(vault.getAbstractFileByPath('Projects/Imgs/Imgs_tasks/shot/attachments/pic.png')).toBeNull()
    expect(vault.getAbstractFileByPath('Projects/Imgs/Imgs_tasks/Archive/shot/attachments/pic.png')).not.toBeNull()

    await store.unarchiveTask(project, task.id)
    expect(vault.getAbstractFileByPath('Projects/Imgs/Imgs_tasks/Archive/shot/attachments/pic.png')).toBeNull()
    expect(vault.getAbstractFileByPath('Projects/Imgs/Imgs_tasks/shot/attachments/pic.png')).not.toBeNull()
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

    // Duplicate twice: the base is trimmed so the "(copy N)" suffix survives the
    // slug cap, so both copies get distinct titles and distinct files.
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

    // Kick off two updates back-to-back without awaiting the first.
    // The second saveProject chains behind the first in the saveQueue, so any
    // markDirty calls from the second mutator must survive the first save's
    // dirty-set drain.
    const first = store.updateTask(project, a.id, { title: 'A new' })
    const second = store.updateTask(project, b.id, { title: 'B new' })
    await Promise.all([first, second])

    expect(vault.getAbstractFileByPath('Projects/Race/Race_tasks/a-new.md')).not.toBeNull()
    expect(vault.getAbstractFileByPath('Projects/Race/Race_tasks/b-new.md')).not.toBeNull()
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

  it('saving a cloned project makes the clone the canonical cached copy', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Clone me', 'Projects')
    await addNamed(store, project, 'task')

    // Same shape as ProjectModal: JSON round-trip plus index rebuild.
    const clone = JSON.parse(JSON.stringify(project)) as typeof project
    clone.taskIndex = buildTaskIndex(clone.tasks)
    clone.description = 'edited in modal'
    await store.saveProject(clone)

    const file = vault.getAbstractFileByPath(project.filePath)
    if (!(file instanceof TFile)) throw new Error('project file missing')
    const reloaded = await store.loadProject(file)
    expect(reloaded).toBe(clone)
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

    const created = vault.getAbstractFileByPath('Projects/Import/Import_tasks/idea.md')
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

    const moved = vault.getAbstractFileByPath('Projects/Import/Import_tasks/idea.md')
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
    const existing = vault.getAbstractFileByPath('Projects/Import/Import_tasks/idea.md')
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
    expect(vault.getAbstractFileByPath('Projects/Arch/Arch_tasks/Archive/old.md')).toBeInstanceOf(TFile)
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

  it('materializes the resolved palette (marker set) when the project overrides nothing', async () => {
    // Feature 5 (INT-017): write-through materialization supersedes the old
    // "omit an empty override block" behavior. An inheriting project now
    // self-describes its palette in `config`, tagged `materialized: true`, but
    // the marker keeps it re-derivable — the resolver still yields the global
    // palette, so it behaves exactly like an inheriting project.
    const { store, vault, app } = newStore()
    const project = await store.createProject('Inherit', 'Projects')
    await store.saveProject(project)

    const store2 = new ProjectStore(app, () => SETTINGS)
    const file = vault.getAbstractFileByPath(project.filePath)
    if (!(file instanceof TFile)) throw new Error('project file missing')
    const written = await vault.read(file)
    expect(written).toContain('config:')
    expect(written).toContain('materialized: true')

    const reloaded = expectDefined(await store2.loadProject(file))
    expect(reloaded.config?.materialized).toBe(true)
    // A materialized block is not a deliberate override: the palette re-derives
    // from the global settings.
    expect(store2.configFor(reloaded).statuses).toEqual(STATUSES)
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

describe('ProjectStore.transact', () => {
  it('batches N mutations into exactly one save and one schedule pass', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Batch', 'Projects')
    const a = await addNamed(store, project, 'Alpha')
    const b = await addNamed(store, project, 'Beta')
    const c = await addNamed(store, project, 'Gamma')
    vault.resetCounts()
    const scheduleSpy = vi.spyOn(store, 'scheduleAfterChange')

    await store.transact(project, async () => {
      await store.updateTask(project, a.id, { status: 'in-progress' })
      await store.updateTask(project, b.id, { status: 'in-progress' })
      await store.updateTask(project, c.id, { status: 'done' })
    })

    // Exactly one project-file write (one save) despite three mutations.
    expect(vault.modifyCount.get(project.filePath)).toBe(1)
    // Each touched task file written exactly once by the single commit save.
    expect(vault.modifyCount.get(expectDefined(a.filePath))).toBe(1)
    expect(vault.modifyCount.get(expectDefined(b.filePath))).toBe(1)
    expect(vault.modifyCount.get(expectDefined(c.filePath))).toBe(1)
    // Exactly one schedule pass for the whole batch.
    expect(scheduleSpy).toHaveBeenCalledTimes(1)
    // Mutations still applied in memory.
    expect(expectDefined(findTask(project.tasks, a.id)).status).toBe('in-progress')
    expect(expectDefined(findTask(project.tasks, c.id)).status).toBe('done')
  })

  it('rolls back the in-memory tree and writes nothing when fn throws', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Abort', 'Projects')
    const a = await addNamed(store, project, 'Alpha')
    const b = await addNamed(store, project, 'Beta')
    vault.resetCounts()

    await expect(
      store.transact(project, async () => {
        await store.updateTask(project, a.id, { status: 'in-progress', title: 'Renamed' })
        await store.updateTask(project, b.id, { status: 'done' })
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    // Nothing hit disk: no project or task writes, no renames.
    expect(vault.modifyCount.get(project.filePath) ?? 0).toBe(0)
    expect(vault.modifyCount.get(expectDefined(a.filePath)) ?? 0).toBe(0)
    expect(vault.modifyCount.get(expectDefined(b.filePath)) ?? 0).toBe(0)
    expect([...vault.createCount.keys()].length).toBe(0)

    // In-memory tree rolled back to the pre-transaction snapshot.
    expect(expectDefined(findTask(project.tasks, a.id)).status).toBe('todo')
    expect(expectDefined(findTask(project.tasks, a.id)).title).toBe('Alpha')
    expect(expectDefined(findTask(project.tasks, b.id)).status).toBe('todo')

    // The aborted dirt is gone: a later save doesn't resurrect the reverted edits.
    vault.resetCounts()
    await store.updateTask(project, 'missing-id', {})
    expect(vault.modifyCount.get(expectDefined(a.filePath)) ?? 0).toBe(0)
    expect(vault.modifyCount.get(expectDefined(b.filePath)) ?? 0).toBe(0)
  })
})

describe('subtree date propagation', () => {
  // VERDICT PROBE: scheduleAfterChange is dependency-based, not containment-based,
  // so shifting a parent's dates does NOT move a subtask that merely nests under
  // it (no dependency edge). shiftTaskDates exists to fill that gap.
  it('scheduleAfterChange leaves a nested subtask untouched when its parent moves', async () => {
    const { store } = newStore()
    const project = await store.createProject('Contain', 'Projects')
    const parent = await addNamed(store, project, 'Parent')
    const child = await addNamed(store, project, 'Child', parent.id)
    await store.updateTask(project, parent.id, { start: '2026-07-01', due: '2026-07-05' })
    await store.updateTask(project, child.id, { start: '2026-07-02', due: '2026-07-03' })

    // Shift the parent's due out by +3d, then run the dependency scheduler.
    await store.updateTask(project, parent.id, { due: '2026-07-08' })
    await store.scheduleAfterChange(project, parent.id)

    const c = expectDefined(findTask(project.tasks, child.id))
    expect(c.start).toBe('2026-07-02') // unchanged — nesting is not a dependency
    expect(c.due).toBe('2026-07-03')
  })

  it('shiftTaskDates drags the subtree by the same delta and reschedules dependents', async () => {
    const { store } = newStore()
    const project = await store.createProject('Drag', 'Projects')
    const parent = await addNamed(store, project, 'Parent')
    const child = await addNamed(store, project, 'Child', parent.id)
    const dependent = await addNamed(store, project, 'Dependent')
    await store.updateTask(project, parent.id, { start: '2026-07-01', due: '2026-07-05' })
    await store.updateTask(project, child.id, { start: '2026-07-02', due: '2026-07-03' })
    await store.updateTask(project, dependent.id, {
      start: '2026-07-06',
      due: '2026-07-07',
      dependencies: [parent.id]
    })

    const n = await store.shiftTaskDates(project, parent.id, 3, { cascadeSubtree: true })
    expect(n).toBe(2) // parent + child both had dates to move

    const p = expectDefined(findTask(project.tasks, parent.id))
    expect(p.start).toBe('2026-07-04')
    expect(p.due).toBe('2026-07-08')
    const c = expectDefined(findTask(project.tasks, child.id))
    expect(c.start).toBe('2026-07-05')
    expect(c.due).toBe('2026-07-06')
    // Dependent cascades: must start the day after the parent's new due (07-08 → 07-09),
    // preserving its 2-day duration.
    const d = expectDefined(findTask(project.tasks, dependent.id))
    expect(d.start).toBe('2026-07-09')
    expect(d.due).toBe('2026-07-10')
  })

  it('shiftTaskDates moves only the target task when cascadeSubtree is false', async () => {
    const { store } = newStore()
    const project = await store.createProject('DragOne', 'Projects')
    const parent = await addNamed(store, project, 'Parent')
    const child = await addNamed(store, project, 'Child', parent.id)
    await store.updateTask(project, parent.id, { start: '2026-07-01', due: '2026-07-05' })
    await store.updateTask(project, child.id, { start: '2026-07-02', due: '2026-07-03' })

    const n = await store.shiftTaskDates(project, parent.id, 5, { cascadeSubtree: false })
    expect(n).toBe(1)

    expect(expectDefined(findTask(project.tasks, parent.id)).start).toBe('2026-07-06')
    expect(expectDefined(findTask(project.tasks, parent.id)).due).toBe('2026-07-10')
    // The nested child stays put.
    expect(expectDefined(findTask(project.tasks, child.id)).start).toBe('2026-07-02')
    expect(expectDefined(findTask(project.tasks, child.id)).due).toBe('2026-07-03')
  })
})

describe('ProjectStore external task ingestion', () => {
  const fileAt = (vault: FakeVault, path: string): TFile => {
    const f = vault.getAbstractFileByPath(path)
    if (!(f instanceof TFile)) throw new Error(`expected a file at ${path}`)
    return f
  }
  const taskBody = (lines: string[]): string => lines.join('\n')
  const fmOf = async (vault: FakeVault, path: string): Promise<Record<string, unknown>> =>
    parseFrontmatter(await vault.cachedRead(fileAt(vault, path))).frontmatter ?? {}

  it('ignores a task file outside the project tasks folder', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Inbox', 'Projects')
    const path = 'Elsewhere/loose.md'
    await vault.create(path, taskBody(['---', 'pm-task: true', 'title: Loose', '---', '', 'body']))
    const before = project.tasks.length
    expect(await store.ingestExternalTask(project, fileAt(vault, path))).toBeNull()
    expect(project.tasks.length).toBe(before)
  })

  it('is idempotent — re-ingesting the same file does not duplicate', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Inbox', 'Projects')
    const path = 'Projects/Inbox/Inbox_tasks/dup.md'
    await vault.create(path, taskBody(['---', 'pm-task: true', 'title: Once', '---', '', 'body']))

    const first = await store.ingestExternalTask(project, fileAt(vault, path))
    expect(first).not.toBeNull()
    const before = flattenTasks(project.tasks).length
    const second = await store.ingestExternalTask(project, fileAt(vault, path))
    expect(second?.id).toBe(first?.id)
    expect(flattenTasks(project.tasks).length).toBe(before)
  })

  it('treats a parentId pointing at a nonexistent parent as top-level', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Inbox', 'Projects')
    const path = 'Projects/Inbox/Inbox_tasks/orphan.md'
    await vault.create(
      path,
      taskBody(['---', 'pm-task: true', 'title: Orphan', 'parentId: ghost-id', '---', '', 'body'])
    )
    const task = await store.ingestExternalTask(project, fileAt(vault, path))
    expect(task).not.toBeNull()
    if (!task) return
    // Landed at top-level, and its id is in the project's persisted taskIds.
    expect(project.tasks.some((t) => t.id === task.id)).toBe(true)
    const taskIds = (await fmOf(vault, project.filePath)).taskIds
    expect(Array.isArray(taskIds) ? taskIds.map(String) : []).toContain(task.id)
  })

  it('nests under an existing parent and persists the parent subtaskIds', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Inbox', 'Projects')
    const parent = await addNamed(store, project, 'Parent')
    const path = 'Projects/Inbox/Inbox_tasks/child-ext.md'
    await vault.create(
      path,
      taskBody(['---', 'pm-task: true', 'title: Child', `parentId: ${parent.id}`, '---', '', 'body'])
    )
    const child = await store.ingestExternalTask(project, fileAt(vault, path))
    expect(child).not.toBeNull()
    if (!child) return
    expect(findTask(project.tasks, child.id)).toBeDefined()
    const parentSubIds = (await fmOf(vault, expectDefined(parent.filePath))).subtaskIds
    expect(Array.isArray(parentSubIds) ? parentSubIds.map(String) : []).toContain(child.id)
  })

  it('marks a task in the Archive subfolder as archived', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Inbox', 'Projects')
    const path = 'Projects/Inbox/Inbox_tasks/Archive/done.md'
    await vault.create(path, taskBody(['---', 'pm-task: true', 'title: Done long ago', '---', '', 'body']))
    const task = await store.ingestExternalTask(project, fileAt(vault, path))
    expect(task).not.toBeNull()
    expect(task?.archived).toBe(true)
  })

  it('preserves an existing non-empty id on the file', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Inbox', 'Projects')
    const path = 'Projects/Inbox/Inbox_tasks/hasid.md'
    await vault.create(path, taskBody(['---', 'pm-task: true', 'id: keep-me-123', 'title: Has id', '---', '', 'body']))
    const task = await store.ingestExternalTask(project, fileAt(vault, path))
    expect(task?.id).toBe('keep-me-123')
    expect((await fmOf(vault, path)).id).toBe('keep-me-123')
  })
})

describe('ProjectStore.isProjectRelevantPath (dashboard vault-wide live-refresh, R28)', () => {
  it('a pm-project file in a custom dir (outside the global folder) is relevant', async () => {
    const { store } = newStore()
    const project = await store.createProject('Cleanup', 'Areas/Community')
    // The loaded project's own file is dashboard-relevant even though it lives
    // OUTSIDE the global projects folder ('Projects').
    expect(store.isProjectRelevantPath(project.filePath)).toBe(true)
  })

  it('a task file under a custom-dir project _tasks folder is relevant', async () => {
    const { store } = newStore()
    const project = await store.createProject('Cleanup', 'Areas/Community')
    const task = await addNamed(store, project, 'Sweep the park')
    const taskPath = expectDefined(task.filePath)
    expect(taskPath.startsWith('Areas/Community/Cleanup/Cleanup_tasks/')).toBe(true)
    expect(store.isProjectRelevantPath(taskPath)).toBe(true)
  })

  it('an unrelated note is not relevant', async () => {
    const { store, vault } = newStore()
    await store.createProject('Cleanup', 'Areas/Community')
    await vault.create('Notes/Random.md', 'not a project')
    expect(store.isProjectRelevantPath('Notes/Random.md')).toBe(false)
  })

  it('a project under the global projects folder stays relevant', async () => {
    const { store } = newStore()
    const project = await store.createProject('Legacy', 'Projects')
    expect(store.isProjectRelevantPath(project.filePath)).toBe(true)
  })

  it('a not-yet-loaded pm-project file is relevant via metadataCache', async () => {
    const { store, vault, app } = newStore()
    const p = 'Areas/Solo/New Project.md'
    await vault.create(
      p,
      ['---', 'pm-project: true', 'title: New Project', 'taskIds: []', '---', '', 'body'].join('\n')
    )
    ;(
      app.metadataCache as unknown as { getFileCache: (f: TFile) => { frontmatter?: Record<string, unknown> } | null }
    ).getFileCache = (file: TFile) => (file.path === p ? { frontmatter: { 'pm-project': true } } : { frontmatter: {} })
    expect(store.isProjectRelevantPath(p)).toBe(true)
  })
})

// ─── INT-018: agent-authored id authority on cold folder-load ────────────────

describe('ProjectStore cold-load id authority', () => {
  function fileAt(vault: FakeVault, path: string): TFile {
    const file = vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) throw new Error(`expected a file at ${path}`)
    return file
  }

  async function seedProject(vault: FakeVault, dir: string, name: string, fmLines: string[]): Promise<TFile> {
    const projectPath = `${dir}/${name}.md`
    await vault.create(projectPath, ['---', 'pm-project: true', ...fmLines, '---', '', 'body'].join('\n'))
    await vault.createFolder(`${dir}/${name}_tasks`)
    return fileAt(vault, projectPath)
  }

  async function fmAt(vault: FakeVault, path: string): Promise<Record<string, unknown>> {
    return parseFrontmatter(await vault.cachedRead(fileAt(vault, path))).frontmatter ?? {}
  }

  const ID_RULE = /^[A-Za-z0-9._-]{1,64}$/

  it('mints a blank id, persists it, and it stays stable across reload', async () => {
    const { store, vault } = newStore()
    const projectFile = await seedProject(vault, 'Projects', 'Blank', ['id: blank-1', 'title: Blank', 'taskIds: []'])
    await vault.create(
      'Projects/Blank_tasks/no-id.md',
      ['---', 'pm-task: true', 'title: No id', '---', '', 'body'].join('\n')
    )

    const project = expectDefined(await store.loadProject(projectFile))
    const loaded = expectDefined(flattenTasks(project.tasks).find((f) => f.task.title === 'No id')).task
    expect(loaded.id.length).toBeGreaterThan(0)
    const mintedId = loaded.id

    const disk = await fmAt(vault, 'Projects/Blank_tasks/no-id.md')
    expect(disk.id).toBe(mintedId)

    // Reload from a fresh store: the persisted id is reused, not re-minted.
    const store2 = new ProjectStore((store as unknown as { app: App }).app, () => SETTINGS)
    const reloaded = expectDefined(await store2.loadProject(projectFile))
    const again = expectDefined(flattenTasks(reloaded.tasks).find((f) => f.task.title === 'No id')).task
    expect(again.id).toBe(mintedId)
  })

  it('resolves a 3-way id collision keep-first, persisting distinct ids', async () => {
    const { store, vault } = newStore()
    const projectFile = await seedProject(vault, 'Projects', 'Three', [
      'id: three-1',
      'title: Three',
      'taskIds:',
      '  - dup'
    ])
    for (const name of ['a', 'b', 'c']) {
      await vault.create(
        `Projects/Three_tasks/${name}.md`,
        ['---', 'pm-task: true', 'id: dup', `title: T-${name}`, '---', '', 'body'].join('\n')
      )
    }

    const project = expectDefined(await store.loadProject(projectFile))
    const ids = flattenTasks(project.tasks)
      .filter((f) => f.task.title.startsWith('T-'))
      .map((f) => f.task.id)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size, 'all three colliding tasks must get distinct ids').toBe(3)
    expect(ids.filter((id) => id === 'dup').length, 'exactly one survivor keeps the original id').toBe(1)
    for (const id of ids) expect(id).toMatch(ID_RULE)

    const diskIds = await Promise.all(
      ['a', 'b', 'c'].map(async (name) => String((await fmAt(vault, `Projects/Three_tasks/${name}.md`)).id))
    )
    expect(new Set(diskIds).size, 'the de-dup must be persisted on disk').toBe(3)
  })

  it('re-mints an invalid id even when a valid duplicate is present', async () => {
    const { store, vault } = newStore()
    const projectFile = await seedProject(vault, 'Projects', 'Mixed', [
      'id: mixed-1',
      'title: Mixed',
      'taskIds:',
      '  - keep'
    ])
    // A valid id and its duplicate, plus a path-separator invalid id.
    await vault.create(
      'Projects/Mixed_tasks/keep.md',
      ['---', 'pm-task: true', 'id: keep', 'title: Keeper', '---', '', 'body'].join('\n')
    )
    await vault.create(
      'Projects/Mixed_tasks/dupe.md',
      ['---', 'pm-task: true', 'id: keep', 'title: Duplicate', '---', '', 'body'].join('\n')
    )
    await vault.create(
      'Projects/Mixed_tasks/bad.md',
      ['---', 'pm-task: true', 'id: epic/frontend', 'title: Invalid', '---', '', 'body'].join('\n')
    )

    const project = expectDefined(await store.loadProject(projectFile))
    const flat = flattenTasks(project.tasks)
    const keeper = expectDefined(flat.find((f) => f.task.title === 'Keeper')).task
    const dupe = expectDefined(flat.find((f) => f.task.title === 'Duplicate')).task
    const invalid = expectDefined(flat.find((f) => f.task.title === 'Invalid')).task

    expect(keeper.id).toBe('keep')
    expect(dupe.id).not.toBe('keep')
    expect(invalid.id).not.toContain('/')
    for (const t of [keeper, dupe, invalid]) expect(t.id).toMatch(ID_RULE)
    expect(new Set([keeper.id, dupe.id, invalid.id]).size).toBe(3)

    expect(String((await fmAt(vault, 'Projects/Mixed_tasks/bad.md')).id)).not.toContain('/')
  })

  it('a project file with a blank id still loads (projects are not minted)', async () => {
    const { store, vault } = newStore()
    // No `id` key on the project frontmatter at all.
    const projectFile = await seedProject(vault, 'Projects', 'NoProjectId', ['title: No Project Id', 'taskIds: []'])
    const project = expectDefined(await store.loadProject(projectFile))
    expect(project.title).toBe('No Project Id')
    expect(project.id.length).toBeGreaterThan(0)
  })

  it('a child whose parentId points at a re-minted collider stays nested under the kept parent', async () => {
    const { store, vault } = newStore()
    const projectFile = await seedProject(vault, 'Projects', 'Nest', [
      'id: nest-1',
      'title: Nest',
      'taskIds:',
      '  - p1'
    ])
    // Two parents share id 'p1' (keep-first: parent-a keeps it, parent-b re-minted).
    await vault.create(
      'Projects/Nest_tasks/parent-a.md',
      ['---', 'pm-task: true', 'id: p1', 'title: Parent A', '---', '', 'body'].join('\n')
    )
    await vault.create(
      'Projects/Nest_tasks/parent-b.md',
      ['---', 'pm-task: true', 'id: p1', 'title: Parent B', '---', '', 'body'].join('\n')
    )
    // The child references the shared id — must resolve to the kept-first parent.
    await vault.create(
      'Projects/Nest_tasks/child.md',
      ['---', 'pm-task: true', 'parentId: p1', 'title: Child', '---', '', 'body'].join('\n')
    )

    const project = expectDefined(await store.loadProject(projectFile))
    const flat = flattenTasks(project.tasks)
    expect(
      flat.find((f) => f.task.title === 'Parent A'),
      'parent A survives'
    ).toBeDefined()
    expect(
      flat.find((f) => f.task.title === 'Parent B'),
      'parent B survives'
    ).toBeDefined()
    const kept = expectDefined(flat.find((f) => f.task.id === 'p1')).task
    const child = expectDefined(kept.subtasks.find((s) => s.title === 'Child'))
    expect(child.title).toBe('Child')
    expect(child.id.length).toBeGreaterThan(0)
  })
})

describe('ProjectStore parent backlinks + content detection (INT-021)', () => {
  const fileAt = (vault: FakeVault, path: string): TFile => {
    const f = vault.getAbstractFileByPath(path)
    if (!(f instanceof TFile)) throw new Error(`expected a file at ${path}`)
    return f
  }
  const bodyOf = async (vault: FakeVault, path: string): Promise<string> =>
    parseFrontmatter(await vault.cachedRead(fileAt(vault, path))).body

  it('writes a sentinel-marked backlink to the immediate parent on insert (task/milestone/project targets)', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Roadmap', 'Projects')
    const projectBase = project.filePath.replace(/^.*\//, '').replace(/\.md$/, '')

    const top = await addNamed(store, project, 'Top task')
    const topBase = expectDefined(top.filePath).replace(/^.*\//, '').replace(/\.md$/, '')
    const sub = await addNamed(store, project, 'Nested subtask', top.id)
    const milestone = makeTask({ title: 'A milestone', type: 'milestone' })
    await store.insertTask(project, milestone)

    const topLine = expectDefined(
      (await bodyOf(vault, expectDefined(top.filePath))).split('\n').find((l) => l.includes('<!-- pm:link -->'))
    )
    expect(topLine).toContain(`[[${projectBase}`)

    const subLine = expectDefined(
      (await bodyOf(vault, expectDefined(sub.filePath))).split('\n').find((l) => l.includes('<!-- pm:link -->'))
    )
    expect(subLine).toContain(`[[${topBase}`)
    expect(subLine).not.toContain(`[[${projectBase}`)

    const msLine = expectDefined(
      (await bodyOf(vault, expectDefined(milestone.filePath))).split('\n').find((l) => l.includes('<!-- pm:link -->'))
    )
    expect(msLine).toContain(`[[${projectBase}`)

    // The frontmatter parent ref is additive/unchanged.
    const subFm = parseFrontmatter(await vault.cachedRead(fileAt(vault, expectDefined(sub.filePath)))).frontmatter ?? {}
    expect(subFm.parentId).toBe(top.id)
  })

  it('hasBodyContent is false for a backlink-only note and true after real prose', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Detect', 'Projects')
    const task = await addNamed(store, project, 'Bare task')
    const file = fileAt(vault, expectDefined(task.filePath))

    expect(await store.hasBodyContent(file)).toBe(false)
    await vault.process(file, (c) => `${c}\n\nA real note.\n`)
    expect(await store.hasBodyContent(file)).toBe(true)
  })

  it('bodyContentLines counts only real prose, excluding frontmatter + the managed link line', async () => {
    const { store, vault } = newStore()
    await store.createProject('Sizer', 'Projects')
    const path = 'Projects/Sizer/Sizer_tasks/sized.md'
    await vault.create(
      path,
      [
        '---',
        'pm-task: true',
        'id: sized-1',
        'title: Sized',
        '---',
        '',
        'Part of [[Sizer]] <!-- pm:link -->',
        '',
        'One.',
        'Two.',
        'Three.'
      ].join('\n')
    )
    expect(await store.bodyContentLines(fileAt(vault, path))).toBe(3)
  })
})

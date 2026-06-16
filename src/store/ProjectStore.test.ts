import type { App } from 'obsidian'
import { TFile } from 'obsidian'
import { describe, expect, it, vi } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../test/fakeVault'
import { makeTask, type Project, type StatusConfig, type Task } from '../types'
import { ProjectStore } from './ProjectStore'
import { buildTaskIndex } from './TaskIndex'
import { flattenTasks } from './TaskTreeOps'

const expectDefined = <T>(value: T | null | undefined, message = 'expected value to be defined'): T => {
  if (value == null) throw new Error(message)
  return value
}

const STATUSES: StatusConfig[] = [
  { id: 'todo', label: 'Todo', color: '#888', icon: 'circle', complete: false },
  { id: 'in-progress', label: 'In progress', color: '#88f', icon: 'loader', complete: false },
  { id: 'done', label: 'Done', color: '#0a0', icon: 'check', complete: true }
]

function newStore(): { store: ProjectStore; vault: FakeVault; app: App } {
  const { app, vault } = makeFakeApp()
  const store = new ProjectStore(app as unknown as App, () => STATUSES)
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
    const store2 = new ProjectStore(app, () => STATUSES)
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

    const store2 = new ProjectStore(app, () => STATUSES)
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

    expect(file.path).toBe('Projects/Imgs_tasks/shot/attachments/pic.png')
    expect(vault.getAbstractFileByPath('Projects/Imgs_tasks/shot/attachments/pic.png')).not.toBeNull()
  })

  it('disambiguates a colliding attachment name', async () => {
    const { store } = newStore()
    const project = await store.createProject('Imgs', 'Projects')
    const task = await addNamed(store, project, 'Shot')

    const first = await store.saveTaskAttachment(project, task, 'pic.png', new ArrayBuffer(4))
    const second = await store.saveTaskAttachment(project, task, 'pic.png', new ArrayBuffer(4))

    expect(first.path).toBe('Projects/Imgs_tasks/shot/attachments/pic.png')
    expect(second.path).toBe('Projects/Imgs_tasks/shot/attachments/pic 1.png')
  })

  it('trashes the attachments folder when the task is deleted', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Imgs', 'Projects')
    const task = await addNamed(store, project, 'Shot')
    await store.saveTaskAttachment(project, task, 'pic.png', new ArrayBuffer(4))

    await store.deleteTask(project, task.id)

    expect(vault.getAbstractFileByPath('Projects/Imgs_tasks/shot/attachments/pic.png')).toBeNull()
    expect(vault.getAbstractFileByPath('Projects/Imgs_tasks/shot')).toBeNull()
  })

  it('moves the attachments folder when the task is renamed', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Imgs', 'Projects')
    const task = await addNamed(store, project, 'Shot')
    await store.saveTaskAttachment(project, task, 'pic.png', new ArrayBuffer(4))

    await store.updateTask(project, task.id, { title: 'Photo' })

    expect(vault.getAbstractFileByPath('Projects/Imgs_tasks/shot/attachments/pic.png')).toBeNull()
    expect(vault.getAbstractFileByPath('Projects/Imgs_tasks/photo/attachments/pic.png')).not.toBeNull()
  })

  it('moves the attachments folder when the task is archived and back when unarchived', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Imgs', 'Projects')
    const task = await addNamed(store, project, 'Shot')
    await store.saveTaskAttachment(project, task, 'pic.png', new ArrayBuffer(4))

    await store.archiveTask(project, task.id)
    expect(vault.getAbstractFileByPath('Projects/Imgs_tasks/shot/attachments/pic.png')).toBeNull()
    expect(vault.getAbstractFileByPath('Projects/Imgs_tasks/Archive/shot/attachments/pic.png')).not.toBeNull()

    await store.unarchiveTask(project, task.id)
    expect(vault.getAbstractFileByPath('Projects/Imgs_tasks/Archive/shot/attachments/pic.png')).toBeNull()
    expect(vault.getAbstractFileByPath('Projects/Imgs_tasks/shot/attachments/pic.png')).not.toBeNull()
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
    const store2 = new ProjectStore(app, () => STATUSES)
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
    const store2 = new ProjectStore(app, () => STATUSES)
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
    const store2 = new ProjectStore(app, () => STATUSES)
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

  it('survives a reload: rebuilt index after load matches the in-memory tree', async () => {
    const { store, vault, app } = newStore()
    const project = await store.createProject('Reload', 'Projects')
    const a = await addNamed(store, project, 'Alpha')
    await addNamed(store, project, 'Child', a.id)
    await addNamed(store, project, 'Beta')

    const store2 = new ProjectStore(app, () => STATUSES)
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
    return expectDefined(await new ProjectStore(app, () => STATUSES).loadProject(file))
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

    expect(vault.getAbstractFileByPath('Projects/Race_tasks/a-new.md')).not.toBeNull()
    expect(vault.getAbstractFileByPath('Projects/Race_tasks/b-new.md')).not.toBeNull()
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

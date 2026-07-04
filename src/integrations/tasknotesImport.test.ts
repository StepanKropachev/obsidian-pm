import { describe, expect, it } from 'vitest'
import type { TaskNotesTaskInfo } from './tasknotes'
import { buildImportForest, type TaskNotesImportItem } from './tasknotesImport'

const OPTS = { defaultStatus: 'todo', defaultPriority: 'medium', taskTag: 'task', archiveTag: 'archived' }

function makeInfo(overrides: Partial<TaskNotesTaskInfo> = {}): TaskNotesTaskInfo {
  return {
    path: 'Tasks/x.md',
    title: 'X',
    status: 'open',
    priority: 'normal',
    archived: false,
    ...overrides
  }
}

function makeItem(path: string, overrides: Partial<TaskNotesImportItem> = {}): TaskNotesImportItem {
  return {
    path,
    info: makeInfo({ path, title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '') }),
    parentPaths: [],
    blockedByPaths: [],
    ...overrides
  }
}

describe('buildImportForest', () => {
  it('maps TaskNotes fields onto the task', () => {
    const item = makeItem('Tasks/a.md')
    item.info = makeInfo({
      path: 'Tasks/a.md',
      title: 'Write docs',
      status: 'in-progress',
      priority: 'high',
      scheduled: '2026-07-06T09:00',
      due: '2026-07-10',
      timeEstimate: 90,
      tags: ['task', 'docs', 'archived'],
      completedDate: '2026-07-09',
      dateCreated: '2026-06-01T10:00:00.000+02:00',
      recurrence: 'DTSTART:20260706;FREQ=WEEKLY;INTERVAL=2'
    })
    const { roots } = buildImportForest([item], OPTS)

    expect(roots).toHaveLength(1)
    const task = roots[0]
    expect(task.title).toBe('Write docs')
    expect(task.status).toBe('in-progress')
    expect(task.priority).toBe('high')
    expect(task.start).toBe('2026-07-06')
    expect(task.due).toBe('2026-07-10')
    expect(task.timeEstimate).toBe(1.5)
    expect(task.tags).toEqual(['docs'])
    expect(task.completed).toBe('2026-07-09')
    expect(task.createdAt).toBe('2026-06-01T10:00:00.000+02:00')
    expect(task.recurrence).toEqual({ interval: 'weekly', every: 2 })
  })

  it('drops complex recurrence rules and falls back to defaults for empty fields', () => {
    const item = makeItem('Tasks/b.md')
    item.info = makeInfo({ path: 'Tasks/b.md', title: 'B', status: '', priority: '', recurrence: 'FREQ=HOURLY' })
    const { roots } = buildImportForest([item], OPTS)
    expect(roots[0].status).toBe('todo')
    expect(roots[0].priority).toBe('medium')
    expect(roots[0].recurrence).toBeUndefined()
  })

  it('turns project links between imported tasks into parent/child edges', () => {
    const parent = makeItem('Tasks/parent.md')
    const child = makeItem('Tasks/child.md', { parentPaths: ['Tasks/parent.md'] })
    const external = makeItem('Tasks/other.md', { parentPaths: ['Projects/Elsewhere.md'] })
    const { roots } = buildImportForest([parent, child, external], OPTS)

    expect(roots.map((t) => t.title)).toEqual(['parent', 'other'])
    expect(roots[0].subtasks.map((t) => t.title)).toEqual(['child'])
    expect(roots[0].subtasks[0].type).toBe('subtask')
  })

  it('breaks project-link cycles instead of nesting forever', () => {
    const a = makeItem('Tasks/a.md', { parentPaths: ['Tasks/b.md'] })
    const b = makeItem('Tasks/b.md', { parentPaths: ['Tasks/a.md'] })
    const { roots } = buildImportForest([a, b], OPTS)

    expect(roots).toHaveLength(1)
    expect(roots[0].subtasks).toHaveLength(1)
  })

  it('maps blockedBy references within the selection to dependencies and drops the rest', () => {
    const blocker = makeItem('Tasks/blocker.md')
    const blocked = makeItem('Tasks/blocked.md', {
      blockedByPaths: ['Tasks/blocker.md', 'Tasks/not-imported.md']
    })
    const { byPath } = buildImportForest([blocker, blocked], OPTS)

    const blockerId = byPath.get('Tasks/blocker.md')?.id
    expect(byPath.get('Tasks/blocked.md')?.dependencies).toEqual([blockerId])
  })

  it('marks archived tasks so they land in the archive folder', () => {
    const item = makeItem('Tasks/done.md')
    item.info = makeInfo({ path: 'Tasks/done.md', title: 'done', archived: true })
    const { roots } = buildImportForest([item], OPTS)
    expect(roots[0].archived).toBe(true)
  })
})

import type { Recurrence, Task } from '../types'
import { makeTask } from '../types'
import type { TaskNotesTaskInfo } from './tasknotes'

/** One selected TaskNotes task with its link references already resolved to vault paths. */
export interface TaskNotesImportItem {
  path: string
  info: TaskNotesTaskInfo
  /** Resolved `projects` link paths; the first one that is also being imported becomes the parent. */
  parentPaths: string[]
  /** Resolved `blockedBy` paths; entries that are also being imported become dependencies. */
  blockedByPaths: string[]
}

export interface TaskNotesImportOptions {
  defaultStatus: string
  defaultPriority: string
  /** TaskNotes' task-identification tag, stripped from imported tags (usually "task"). */
  taskTag: string
  /** TaskNotes' archive tag, stripped from imported tags (usually "archived"). */
  archiveTag: string
}

const RRULE_INTERVALS: Record<string, Recurrence['interval']> = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly'
}

/** Map a simple RRULE (FREQ + optional INTERVAL) to our recurrence model; complex rules are dropped. */
function mapRecurrence(rrule: string | undefined): Recurrence | undefined {
  const freq = rrule?.match(/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/)
  if (!freq) return undefined
  const every = rrule?.match(/INTERVAL=(\d+)/)
  return { interval: RRULE_INTERVALS[freq[1]], every: every ? parseInt(every[1], 10) : 1 }
}

function dateOnly(value: string | undefined): string {
  return value ? value.slice(0, 10) : ''
}

function mapItemToTask(item: TaskNotesImportItem, opts: TaskNotesImportOptions): Task {
  const info = item.info
  const task = makeTask({
    title: info.title || item.path.slice(item.path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
    status: info.status || opts.defaultStatus,
    priority: info.priority || opts.defaultPriority,
    start: dateOnly(info.scheduled),
    due: dateOnly(info.due),
    completed: dateOnly(info.completedDate),
    tags: (info.tags ?? []).filter((t) => t !== opts.taskTag && t !== opts.archiveTag),
    recurrence: mapRecurrence(info.recurrence)
  })
  if (info.timeEstimate && info.timeEstimate > 0) {
    task.timeEstimate = Math.round((info.timeEstimate / 60) * 100) / 100
  }
  if (info.dateCreated) task.createdAt = info.dateCreated
  if (info.dateModified) task.updatedAt = info.dateModified
  if (info.archived) task.archived = true
  return task
}

/**
 * Convert resolved TaskNotes tasks into a task forest: project links between
 * imported tasks become parent/child edges (first match wins, cycles break to
 * root), and blockedBy references between imported tasks become dependencies.
 * References to notes outside the import selection are dropped.
 */
export function buildImportForest(
  items: TaskNotesImportItem[],
  opts: TaskNotesImportOptions
): { roots: Task[]; byPath: Map<string, Task> } {
  const byPath = new Map<string, Task>()
  for (const item of items) {
    byPath.set(item.path, mapItemToTask(item, opts))
  }

  const parentOf = new Map<string, string>()
  for (const item of items) {
    const candidate = item.parentPaths.find((p) => p !== item.path && byPath.has(p))
    if (!candidate) continue
    // Walk the ancestor chain; adopting a parent whose ancestry includes this
    // task would create a cycle, so such a task stays a root.
    let ancestor: string | undefined = candidate
    let cycle = false
    while (ancestor) {
      if (ancestor === item.path) {
        cycle = true
        break
      }
      ancestor = parentOf.get(ancestor)
    }
    if (!cycle) parentOf.set(item.path, candidate)
  }

  const roots: Task[] = []
  for (const item of items) {
    const task = byPath.get(item.path)
    if (!task) continue
    const parentPath = parentOf.get(item.path)
    if (parentPath) {
      const parent = byPath.get(parentPath)
      if (parent) {
        task.type = 'subtask'
        parent.subtasks.push(task)
        continue
      }
    }
    roots.push(task)
  }

  for (const item of items) {
    const task = byPath.get(item.path)
    if (!task) continue
    task.dependencies = item.blockedByPaths
      .filter((p) => p !== item.path && byPath.has(p))
      .map((p) => byPath.get(p)?.id)
      .filter((id): id is string => !!id)
  }

  return { roots, byPath }
}

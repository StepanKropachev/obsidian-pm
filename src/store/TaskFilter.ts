import type { Task, FilterState, DueDateFilter, StatusConfig } from '../types'
import type { FlatTask } from './TaskTreeOps'
import { isTerminalStatus } from '../utils'
import { Temporal, today, parsePlainDate } from '../dates'

export function isFilterActive(filter: FilterState): boolean {
  return !!(
    filter.text ||
    filter.statuses.length ||
    filter.priorities.length ||
    filter.assignees.length ||
    filter.tags.length ||
    filter.dueDateFilter !== 'any'
  )
}

export function countActiveFilters(filter: FilterState): number {
  let count = 0
  if (filter.text) count++
  if (filter.statuses.length) count++
  if (filter.priorities.length) count++
  if (filter.assignees.length) count++
  if (filter.tags.length) count++
  if (filter.dueDateFilter !== 'any') count++
  if (filter.showArchived) count++
  return count
}

export function matchesFilter(task: Task, filter: FilterState, statuses: StatusConfig[] = []): boolean {
  if (task.archived && !filter.showArchived) return false
  if (filter.text) {
    const q = filter.text.toLowerCase()
    if (
      !(
        task.title.toLowerCase().includes(q) ||
        task.status.includes(q) ||
        task.priority.includes(q) ||
        task.assignees.some((a) => a.toLowerCase().includes(q)) ||
        task.tags.some((t) => t.toLowerCase().includes(q))
      )
    ) {
      return false
    }
  }
  if (filter.statuses.length && !filter.statuses.includes(task.status)) return false
  if (filter.priorities.length && !filter.priorities.includes(task.priority)) return false
  if (filter.assignees.length && !task.assignees.some((a) => filter.assignees.includes(a))) return false
  if (filter.tags.length && !task.tags.some((t) => filter.tags.includes(t))) return false
  if (filter.dueDateFilter !== 'any' && !matchDueDateFilter(task, filter.dueDateFilter, statuses)) return false
  return true
}

export function applyTaskFilter(tasks: Task[], filter: FilterState, statuses: StatusConfig[] = []): Task[] {
  return tasks
    .filter((t) => matchesFilter(t, filter, statuses))
    .map((t) => (t.subtasks.length ? { ...t, subtasks: applyTaskFilter(t.subtasks, filter, statuses) } : t))
}

/**
 * Tree-shaped filter that lifts orphaned matching descendants to the slot of
 * their dropped ancestor. Used by the gantt view so a matching subtask doesn't
 * disappear when its parent doesn't match.
 */
export function applyTaskFilterPromote(tasks: Task[], filter: FilterState, statuses: StatusConfig[] = []): Task[] {
  const result: Task[] = []
  for (const t of tasks) {
    const filteredSubs = t.subtasks.length ? applyTaskFilterPromote(t.subtasks, filter, statuses) : []
    if (matchesFilter(t, filter, statuses)) {
      result.push({ ...t, subtasks: filteredSubs })
    } else {
      result.push(...filteredSubs)
    }
  }
  return result
}

export function applyTaskFilterFlat(flat: FlatTask[], filter: FilterState, statuses: StatusConfig[] = []): FlatTask[] {
  return flat.filter(({ task }) => matchesFilter(task, filter, statuses))
}

function matchDueDateFilter(task: Task, filter: DueDateFilter, statuses: StatusConfig[]): boolean {
  if (filter === 'no-date') return !task.due
  const due = parsePlainDate(task.due)
  if (!due) return false
  const now = today()

  switch (filter) {
    case 'overdue':
      return Temporal.PlainDate.compare(due, now) < 0 && !isTerminalStatus(task.status, statuses)
    case 'this-week': {
      const daysToEnd = 7 - (now.dayOfWeek % 7)
      const endOfWeek = now.add({ days: daysToEnd })
      return Temporal.PlainDate.compare(due, now) >= 0 && Temporal.PlainDate.compare(due, endOfWeek) <= 0
    }
    case 'this-month':
      return due.year === now.year && due.month === now.month && Temporal.PlainDate.compare(due, now) >= 0
    default:
      return true
  }
}

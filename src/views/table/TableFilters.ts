import type { Task, FilterState, TaskPriority, DueDateFilter, StatusConfig } from '../../types'
import type { FlatTask } from '../../store/TaskTreeOps'
import type { TableState } from './TableRenderer'
import { isTerminalStatus, statusSortOrder } from '../../utils'
import { Temporal, today, parsePlainDate } from '../../dates'

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

export function applyFilters(flat: FlatTask[], filter: FilterState, statuses: StatusConfig[] = []): FlatTask[] {
  return flat.filter(({ task }) => {
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
    if (filter.dueDateFilter !== 'any') {
      if (!matchDueDateFilter(task, filter.dueDateFilter, statuses)) return false
    }
    return true
  })
}

function matchDueDateFilter(task: Task, filter: DueDateFilter, statuses: StatusConfig[] = []): boolean {
  if (filter === 'no-date') return !task.due
  const due = parsePlainDate(task.due)
  if (!due) return false
  const now = today()

  switch (filter) {
    case 'overdue':
      return Temporal.PlainDate.compare(due, now) < 0 && !isTerminalStatus(task.status, statuses)
    case 'this-week': {
      // Preserve pre-Temporal behavior: the original used JS getDay (Sunday=0..Saturday=6)
      // and added `7 - dayOfWeek` days, so the window ran from today through the upcoming Sunday.
      const daysToEnd = 7 - (now.dayOfWeek % 7) // Temporal dayOfWeek: Mon=1..Sun=7
      const endOfWeek = now.add({ days: daysToEnd })
      return Temporal.PlainDate.compare(due, now) >= 0 && Temporal.PlainDate.compare(due, endOfWeek) <= 0
    }
    case 'this-month':
      return due.year === now.year && due.month === now.month && Temporal.PlainDate.compare(due, now) >= 0
    default:
      return true
  }
}

export function compareTask(a: Task, b: Task, state: TableState, statuses: StatusConfig[] = []): number {
  const dir = state.sortDir === 'asc' ? 1 : -1
  switch (state.sortKey) {
    case 'title':
      return dir * a.title.localeCompare(b.title)
    case 'status':
      return dir * (statusSortOrder(a.status, statuses) - statusSortOrder(b.status, statuses))
    case 'priority':
      return dir * priorityOrder(a.priority) - dir * priorityOrder(b.priority)
    case 'due':
      return dir * (a.due || 'zzz').localeCompare(b.due || 'zzz')
    case 'assignees':
      return dir * (a.assignees[0] ?? '').localeCompare(b.assignees[0] ?? '')
    case 'progress':
      return dir * (a.progress - b.progress)
    default:
      return 0
  }
}

function priorityOrder(p: TaskPriority): number {
  return { critical: 0, high: 1, medium: 2, low: 3 }[p] ?? 99
}

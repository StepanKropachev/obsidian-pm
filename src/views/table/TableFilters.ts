import type { Task, FilterState, TaskPriority, DueDateFilter, StatusConfig } from '../../types'
import type { FlatTask } from '../../store/TaskTreeOps'
import type { TableState } from './TableRenderer'
import { isTerminalStatus, statusSortOrder } from '../../utils'

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
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  switch (filter) {
    case 'no-date':
      return !task.due
    case 'overdue': {
      if (!task.due) return false
      const d = new Date(task.due)
      return d < today && !isTerminalStatus(task.status, statuses)
    }
    case 'this-week': {
      if (!task.due) return false
      const d = new Date(task.due)
      const endOfWeek = new Date(today)
      const dayOfWeek = today.getDay()
      endOfWeek.setDate(today.getDate() + (7 - dayOfWeek))
      return d >= today && d <= endOfWeek
    }
    case 'this-month': {
      if (!task.due) return false
      const d = new Date(task.due)
      return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear() && d >= today
    }
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

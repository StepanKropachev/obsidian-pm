import type { Task, TaskPriority, StatusConfig } from '../../types'
import type { TableState } from './TableRenderer'
import { statusSortOrder } from '../../utils'

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

import type { Task, TaskPriority, StatusConfig, PriorityConfig } from '../../types'
import type { TableState } from './TableRenderer'
import { statusSortOrder } from '../../utils'

export function compareTask(
  a: Task,
  b: Task,
  state: TableState,
  statuses: StatusConfig[] = [],
  priorities: PriorityConfig[] = []
): number {
  const dir = state.sortDir === 'asc' ? 1 : -1
  switch (state.sortKey) {
    case 'title':
      return dir * a.title.localeCompare(b.title)
    case 'status':
      return dir * (statusSortOrder(a.status, statuses) - statusSortOrder(b.status, statuses))
    case 'priority':
      return dir * (priorityOrder(a.priority, priorities) - priorityOrder(b.priority, priorities))
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

function priorityOrder(p: TaskPriority, priorities: PriorityConfig[]): number {
  const idx = priorities.findIndex((cfg) => cfg.id === p)
  return idx >= 0 ? idx : 999
}

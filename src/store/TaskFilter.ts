import { parsePlainDate, Temporal, today } from '../dates'
import type { CustomFieldFilterSelection, DueDateFilter, FilterState, StatusConfig, Task } from '../types'
import { isTerminalStatus } from '../utils'
import type { FlatTask } from './TaskTreeOps'

export function isFilterActive(filter: FilterState): boolean {
  return !!(
    filter.text ||
    filter.statuses.length ||
    filter.priorities.length ||
    filter.assignees.length ||
    filter.tags.length ||
    filter.dueDateFilter !== 'any' ||
    Object.values(filter.customFields ?? {}).some(isCustomFieldSelectionActive)
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
  count += Object.values(filter.customFields ?? {}).filter(isCustomFieldSelectionActive,).length
  return count
}

export function matchesFilter(task: Task, filter: FilterState, statuses: StatusConfig[] = []): boolean {
  if (task.archived && !filter.showArchived) return false
  const q = filter.text.trim().toLowerCase()
  if (q) {
    if (
      !(
        task.id.toLowerCase() === q ||
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
  for (const [fieldId, selection] of Object.entries(filter.customFields ?? {})) {
    if (!matchesCustomFieldFilter(task.customFields[fieldId], selection)) return false
  }
  return true
}

export function applyTaskFilter(tasks: Task[], filter: FilterState, statuses: StatusConfig[] = []): Task[] {
  return tasks
    .filter((t) => matchesFilter(t, filter, statuses))
    .map((t) => (t.subtasks.length ? { ...t, subtasks: applyTaskFilter(t.subtasks, filter, statuses) } : t))
}

function isCustomFieldSelectionActive(selection: CustomFieldFilterSelection | undefined): boolean {
  if (!selection) return false
  if (selection.type === 'multiselect') {
    return Array.isArray(selection.value) && selection.value.length > 0
  }
  return selection.value !== undefined && selection.value !== null && selection.value !== ''
}

function matchesCustomFieldFilter(actual: unknown, selection: CustomFieldFilterSelection | undefined): boolean {
  if (!selection || !isCustomFieldSelectionActive(selection)) return true
  switch (selection.type) {
    case 'checkbox':
      return Boolean(actual) === Boolean(selection.value)
    case 'multiselect': {
      const selected = Array.isArray(selection.value) ? selection.value : []
      const values = Array.isArray(actual) ? actual : []
      return selected.some((option) => values.includes(option))
    }
    case 'number': {
      const expected = Number(selection.value)
      const actualNumber = typeof actual === 'number' ? actual : typeof actual === 'string' ? Number(actual) : Number.NaN
      return Number.isNaN(expected) ? false : actualNumber === expected
    }
    default: {
      const actualText =
        typeof actual === 'string'
          ? actual
          : typeof actual === 'number' || typeof actual === 'boolean'
            ? String(actual)
            : ''
      return actualText === String(selection.value)
    }
  }
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

import type { Task, FilterState, TaskStatus, TaskPriority, DueDateFilter } from '../../types';
import type { FlatTask } from '../../store/TaskTreeOps';
import type { TableState } from './TableRenderer';

export function applyFilters(flat: FlatTask[], filter: FilterState): FlatTask[] {
  return flat.filter(({ task }) => {
    if (task.archived && !filter.showArchived) return false;
    if (filter.text) {
      const q = filter.text.toLowerCase();
      if (!(task.title.toLowerCase().includes(q) ||
            task.status.includes(q) ||
            task.priority.includes(q) ||
            task.assignees.some(a => a.toLowerCase().includes(q)) ||
            task.tags.some(t => t.toLowerCase().includes(q)))) return false;
    }
    if (filter.statuses.length && !filter.statuses.includes(task.status)) return false;
    if (filter.priorities.length && !filter.priorities.includes(task.priority)) return false;
    if (filter.assignees.length && !task.assignees.some(a => filter.assignees.includes(a))) return false;
    if (filter.tags.length && !task.tags.some(t => filter.tags.includes(t))) return false;
    if (filter.dueDateFilter !== 'any') {
      if (!matchDueDateFilter(task, filter.dueDateFilter)) return false;
    }
    return true;
  });
}

function matchDueDateFilter(task: Task, filter: DueDateFilter): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  switch (filter) {
    case 'no-date':
      return !task.due;
    case 'overdue': {
      if (!task.due) return false;
      const d = new Date(task.due);
      return d < today && task.status !== 'done' && task.status !== 'cancelled';
    }
    case 'this-week': {
      if (!task.due) return false;
      const d = new Date(task.due);
      const endOfWeek = new Date(today);
      const dayOfWeek = today.getDay();
      endOfWeek.setDate(today.getDate() + (7 - dayOfWeek));
      return d >= today && d <= endOfWeek;
    }
    case 'this-month': {
      if (!task.due) return false;
      const d = new Date(task.due);
      return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear() && d >= today;
    }
    default:
      return true;
  }
}

export function compareTask(a: Task, b: Task, state: TableState): number {
  const dir = state.sortDir === 'asc' ? 1 : -1;
  switch (state.sortKey) {
    case 'title':     return dir * a.title.localeCompare(b.title);
    case 'status':    return dir * statusOrder(a.status) - dir * statusOrder(b.status);
    case 'priority':  return dir * priorityOrder(a.priority) - dir * priorityOrder(b.priority);
    case 'due':       return dir * (a.due || 'zzz').localeCompare(b.due || 'zzz');
    case 'assignees': return dir * (a.assignees[0] ?? '').localeCompare(b.assignees[0] ?? '');
    case 'progress':  return dir * (a.progress - b.progress);
    default:          return 0;
  }
}

function statusOrder(s: TaskStatus): number {
  return { 'in-progress': 0, 'blocked': 1, 'review': 2, 'todo': 3, 'done': 4, 'cancelled': 5 }[s] ?? 99;
}

function priorityOrder(p: TaskPriority): number {
  return { critical: 0, high: 1, medium: 2, low: 3 }[p] ?? 99;
}

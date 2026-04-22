import type { Task, StatusConfig } from '../types'
import { isTerminalStatus } from '../utils'

/** Flatten a task tree into a list, preserving depth info */
export interface FlatTask {
  task: Task
  depth: number
  parentId: string | null
  visible: boolean
}

export function flattenTasks(
  tasks: Task[],
  depth = 0,
  parentId: string | null = null,
  ancestorCollapsed = false
): FlatTask[] {
  const result: FlatTask[] = []
  for (const task of tasks) {
    const visible = !ancestorCollapsed
    result.push({ task, depth, parentId, visible })
    if (task.subtasks.length > 0) {
      result.push(...flattenTasks(task.subtasks, depth + 1, task.id, ancestorCollapsed || task.collapsed))
    }
  }
  return result
}

/** Find a task anywhere in the tree by id */
export function findTask(tasks: Task[], id: string): Task | null {
  for (const t of tasks) {
    if (t.id === id) return t
    const found = findTask(t.subtasks, id)
    if (found) return found
  }
  return null
}

/** Mutate task tree: update a task by id */
export function updateTaskInTree(tasks: Task[], id: string, patch: Partial<Task>): boolean {
  for (const t of tasks) {
    if (t.id === id) {
      Object.assign(t, patch, { updatedAt: new Date().toISOString() })
      return true
    }
    if (updateTaskInTree(t.subtasks, id, patch)) return true
  }
  return false
}

/** Mutate task tree: delete a task by id */
export function deleteTaskFromTree(tasks: Task[], id: string): boolean {
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i].id === id) {
      tasks.splice(i, 1)
      return true
    }
    if (deleteTaskFromTree(tasks[i].subtasks, id)) return true
  }
  return false
}

/** Add a subtask under a parent; or top-level if parentId is null */
export function addTaskToTree(tasks: Task[], newTask: Task, parentId: string | null): void {
  if (!parentId) {
    tasks.push(newTask)
    return
  }
  const parent = findTask(tasks, parentId)
  if (parent) parent.subtasks.push(newTask)
  else tasks.push(newTask)
}

/** Move a task before or after another task in the tree (same level) */
export function moveTaskInTree(tasks: Task[], taskId: string, targetId: string, position: 'before' | 'after'): boolean {
  // Try at this level first
  const taskIdx = tasks.findIndex((t) => t.id === taskId)
  const targetIdx = tasks.findIndex((t) => t.id === targetId)
  if (taskIdx !== -1 && targetIdx !== -1) {
    const [task] = tasks.splice(taskIdx, 1)
    const insertIdx = tasks.findIndex((t) => t.id === targetId)
    tasks.splice(position === 'before' ? insertIdx : insertIdx + 1, 0, task)
    return true
  }
  // Recurse into subtasks
  for (const t of tasks) {
    if (moveTaskInTree(t.subtasks, taskId, targetId, position)) return true
  }
  return false
}

/** Filter archived tasks from a task tree (returns a shallow copy) */
export function filterArchived(tasks: Task[]): Task[] {
  return tasks
    .filter((t) => !t.archived)
    .map((t) => (t.subtasks.length ? { ...t, subtasks: filterArchived(t.subtasks) } : t))
}

/** Filter terminal (complete) tasks from a task tree (returns a shallow copy) */
export function filterDone(tasks: Task[], statuses: StatusConfig[]): Task[] {
  return tasks
    .filter((t) => !isTerminalStatus(t.status, statuses))
    .map((t) => (t.subtasks.length ? { ...t, subtasks: filterDone(t.subtasks, statuses) } : t))
}

/** Collect all unique assignees from a task tree */
export function collectAllAssignees(tasks: Task[], extra?: string[]): string[] {
  const set = new Set<string>()
  if (extra) for (const m of extra) set.add(m)
  const walk = (list: Task[]) => {
    for (const t of list) {
      for (const a of t.assignees) set.add(a)
      walk(t.subtasks)
    }
  }
  walk(tasks)
  return [...set].filter(Boolean).sort()
}

/** Collect all unique tags from a task tree */
export function collectAllTags(tasks: Task[]): string[] {
  const set = new Set<string>()
  const walk = (list: Task[]) => {
    for (const t of list) {
      for (const tag of t.tags) set.add(tag)
      walk(t.subtasks)
    }
  }
  walk(tasks)
  return [...set].filter(Boolean).sort()
}

/** Sum all logged hours for a task */
export function totalLoggedHours(task: Task): number {
  if (!task.timeLogs?.length) return 0
  return task.timeLogs.reduce((sum, log) => sum + log.hours, 0)
}

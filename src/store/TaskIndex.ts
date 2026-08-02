import type { Project, Task } from '../types'

export interface TaskIndexEntry {
  task: Task
  parentId: string | null
}

export type TaskIndex = Map<string, TaskIndexEntry>

export function buildTaskIndex(tasks: Task[]): TaskIndex {
  const idx: TaskIndex = new Map()
  const walk = (list: Task[], parentId: string | null): void => {
    for (const task of list) {
      idx.set(task.id, { task, parentId })
      if (task.subtasks.length) walk(task.subtasks, task.id)
    }
  }
  walk(tasks, null)
  return idx
}

/** Use after a bulk load. Incremental changes go through the helpers below. */
export function rebuildTaskIndex(project: Project): void {
  project.taskIndex = buildTaskIndex(project.tasks)
}

export function findTaskById(project: Project, id: string): Task | null {
  return project.taskIndex.get(id)?.task ?? null
}

/** Null for top-level tasks and for unknown ids alike. */
export function findParentId(project: Project, id: string): string | null {
  return project.taskIndex.get(id)?.parentId ?? null
}

/** Call after splicing the task into the tree. */
export function indexAddSubtree(project: Project, task: Task, parentId: string | null): void {
  project.taskIndex.set(task.id, { task, parentId })
  for (const sub of task.subtasks) indexAddSubtree(project, sub, task.id)
}

/** Call either side of the splice; the task ref carries its subtree regardless. */
export function indexRemoveSubtree(project: Project, task: Task): void {
  project.taskIndex.delete(task.id)
  for (const sub of task.subtasks) indexRemoveSubtree(project, sub)
}

/** The task's own subtree is unaffected. */
export function indexSetParent(project: Project, id: string, parentId: string | null): void {
  const entry = project.taskIndex.get(id)
  if (entry) entry.parentId = parentId
}

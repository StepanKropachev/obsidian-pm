import type { Project, Task } from '../types'

export interface TaskIndexEntry {
  task: Task
  parentId: string | null
}

export type TaskIndex = Map<string, TaskIndexEntry>

/** Walk a tree and build the id → {task, parentId} index. O(N). */
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

/** Rebuild a project's index from its current tree. Use after a bulk load. */
export function rebuildTaskIndex(project: Project): void {
  project.taskIndex = buildTaskIndex(project.tasks)
}

/** O(1) task lookup by id. */
export function findTaskById(project: Project, id: string): Task | null {
  return project.taskIndex.get(id)?.task ?? null
}

/** O(1) parent-id lookup. Returns null for top-level tasks and unknown ids. */
export function findParentId(project: Project, id: string): string | null {
  return project.taskIndex.get(id)?.parentId ?? null
}

/** Add a task and its entire subtree to the index. Call after splicing into the tree. */
export function indexAddSubtree(project: Project, task: Task, parentId: string | null): void {
  project.taskIndex.set(task.id, { task, parentId })
  for (const sub of task.subtasks) indexAddSubtree(project, sub, task.id)
}

/** Remove a task and its entire subtree from the index. Call before or after the splice — the task ref carries its subtree either way. */
export function indexRemoveSubtree(project: Project, task: Task): void {
  project.taskIndex.delete(task.id)
  for (const sub of task.subtasks) indexRemoveSubtree(project, sub)
}

/** Update only a task's parentId in the index. The task's own subtree is unaffected. */
export function indexSetParent(project: Project, id: string, parentId: string | null): void {
  const entry = project.taskIndex.get(id)
  if (entry) entry.parentId = parentId
}

// Dependency/status helpers. The read-side predicates (`isComplete`,
// `unmetDeps`, `directDependents`) are shared by `blocked`, `next`, `open`, and
// `deps`; the write-side `cascadeAfterMutation` / `previewCascade` wrap the
// store's `scheduleAfterChange` pass for the mutation commands (`set`, `depend`,
// `shift`, `apply`) — reusing the scheduler, never re-implementing it.

import type { Project, StatusConfig, Task } from '../../src/types'
import { computeSchedule, findTaskById, flattenTasks } from '../../src/store'
import type { PmContext } from './PmContext'

/** True when a task's status is terminal per the project's resolved palette. */
export function isComplete(task: Task, statuses: StatusConfig[]): boolean {
  return statuses.find((s) => s.id === task.status)?.complete ?? false
}

/** The subset of a task's dependency ids that are not yet complete. */
export function unmetDeps(project: Project, task: Task, statuses: StatusConfig[]): string[] {
  return task.dependencies.filter((depId) => {
    const dep = findTaskById(project, depId)
    return dep ? !isComplete(dep, statuses) : false
  })
}

/** Tasks that depend on `taskId` (its direct dependents). */
export function directDependents(project: Project, taskId: string): Task[] {
  return flattenTasks(project.tasks)
    .map((f) => f.task)
    .filter((t) => t.dependencies.includes(taskId))
}

/** A `start|due` fingerprint per task id, for diffing before/after a schedule pass. */
function dateFingerprint(project: Project): Map<string, string> {
  const map = new Map<string, string>()
  for (const f of flattenTasks(project.tasks)) map.set(f.task.id, `${f.task.start}|${f.task.due}`)
  return map
}

/**
 * Run one post-mutation `scheduleAfterChange` pass on `project` (a no-op when the
 * project disables auto-scheduling) and return the ids the scheduler actually
 * moved — the `data.scheduled` set that is a subset of `changed_ids`. The store
 * persists the moves; this only diffs the in-memory tree to name them.
 */
export async function cascadeAfterMutation(
  ctx: PmContext,
  project: Project,
  changedTaskId?: string
): Promise<string[]> {
  const before = dateFingerprint(project)
  await ctx.store.scheduleAfterChange(project, changedTaskId)
  const moved: string[] = []
  for (const f of flattenTasks(project.tasks)) {
    const prev = before.get(f.task.id)
    const now = `${f.task.start}|${f.task.due}`
    if (prev !== undefined && prev !== now) moved.push(f.task.id)
  }
  return moved
}

/**
 * Compute — without writing — which dependents a schedule pass WOULD move, given
 * a patch already applied to the in-memory tree. Used by `--dry-run` so the
 * report names the cascade the real run would perform.
 */
export function previewCascade(project: Project, statuses: StatusConfig[], changedTaskId?: string): string[] {
  const { patches } = computeSchedule(project.tasks, changedTaskId, statuses)
  return patches.map((p) => p.taskId)
}

/** True when a patch touches a field that should trigger a schedule pass. */
export function patchTriggersSchedule(patch: Record<string, unknown>): boolean {
  return ['due', 'start', 'dependencies', 'status'].some((k) => k in patch)
}

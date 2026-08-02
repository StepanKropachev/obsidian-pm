import { Temporal } from '../dates'
import type { StatusConfig, Task } from '../types'
import { isTerminalStatus } from '../utils'
import { flattenTasks } from './TaskTreeOps'

export interface SchedulePatch {
  taskId: string
  start: string // YYYY-MM-DD
  due: string // YYYY-MM-DD
}

export interface ScheduleResult {
  patches: SchedulePatch[]
  cycles: string[][]
}

export function daysBetween(a: string, b: string): number {
  return Temporal.PlainDate.from(b).since(Temporal.PlainDate.from(a), { largestUnit: 'days' }).days
}

export function addDays(date: string, n: number): string {
  return Temporal.PlainDate.from(date).add({ days: n }).toString()
}

/**
 * Would making `from` depend on `to` close a cycle? "from depends on to" is the edge
 * to -> from, so yes exactly when `from` can already reach `to`.
 */
export function wouldCreateCycle(tasks: Task[], fromId: string, toId: string): boolean {
  const flat = flattenTasks(tasks).map((ft) => ft.task)
  const dependentsOf = new Map<string, string[]>()
  for (const t of flat) {
    for (const depId of t.dependencies) {
      const list = dependentsOf.get(depId) ?? []
      list.push(t.id)
      dependentsOf.set(depId, list)
    }
  }
  const visited = new Set<string>()
  const queue = [fromId]
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) break
    if (current === toId) return true
    if (visited.has(current)) continue
    visited.add(current)
    for (const next of dependentsOf.get(current) ?? []) {
      queue.push(next)
    }
  }
  return false
}

/**
 * Date patches derived from the dependency graph. `changedTaskId` scopes the pass to
 * that task's downstream dependents. Terminal-status tasks never move; their dates are
 * a record of what happened.
 *
 * With `pullForward`, a predecessor that finished early counts as ending on its
 * completion date and its dependents move up by the days saved, keeping their existing
 * slack and never starting before the day after a predecessor ends.
 */
export function computeSchedule(
  tasks: Task[],
  changedTaskId?: string,
  statuses: StatusConfig[] = [],
  pullForward = false
): ScheduleResult {
  const flat = flattenTasks(tasks).map((ft) => ft.task)
  const taskById = new Map<string, Task>()
  const dependentsOf = new Map<string, string[]>()
  const predecessorsOf = new Map<string, string[]>()

  for (const t of flat) {
    taskById.set(t.id, t)
  }

  for (const t of flat) {
    const validDeps: string[] = []
    for (const depId of t.dependencies) {
      if (!taskById.has(depId)) continue
      validDeps.push(depId)
      const list = dependentsOf.get(depId) ?? []
      list.push(t.id)
      dependentsOf.set(depId, list)
    }
    predecessorsOf.set(t.id, validDeps)
  }

  let scopeIds: Set<string> | null = null
  if (changedTaskId) {
    scopeIds = new Set<string>()
    const queue = [changedTaskId]
    while (queue.length > 0) {
      const id = queue.shift()
      if (id === undefined) break
      if (scopeIds.has(id)) continue
      scopeIds.add(id)
      for (const depId of dependentsOf.get(id) ?? []) {
        queue.push(depId)
      }
    }
  }

  // Kahn's algorithm: topological sort, with the leftovers being the cycles.
  const inDegree = new Map<string, number>()
  const relevantIds = scopeIds ? [...scopeIds] : flat.map((t) => t.id)

  const scope = scopeIds
  for (const id of relevantIds) {
    const deps = predecessorsOf.get(id) ?? []
    const filtered = scope ? deps.filter((d) => scope.has(d)) : deps
    inDegree.set(id, filtered.length)
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const topoOrder: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined) break
    topoOrder.push(id)
    for (const depId of dependentsOf.get(id) ?? []) {
      const currentDeg = inDegree.get(depId)
      if (currentDeg === undefined) continue
      const newDeg = currentDeg - 1
      inDegree.set(depId, newDeg)
      if (newDeg === 0) queue.push(depId)
    }
  }

  const sortedSet = new Set(topoOrder)
  const cycleIds = relevantIds.filter((id) => !sortedSet.has(id))
  const cycles: string[][] = cycleIds.length > 0 ? [cycleIds] : []

  // Mutable copies of the dates, so a shift cascades within this run.
  const startOf = new Map<string, string>()
  const dueOf = new Map<string, string>()
  // Days by which a task's finish beat the date it was planned for.
  const daysSavedBy = new Map<string, number>()
  for (const t of flat) {
    startOf.set(t.id, t.start)
    dueOf.set(t.id, t.due)
    if (!pullForward || !t.completed || !t.due || t.completed >= t.due) continue
    if (!isTerminalStatus(t.status, statuses)) continue
    dueOf.set(t.id, t.completed)
    daysSavedBy.set(t.id, daysBetween(t.completed, t.due))
  }

  const patches: SchedulePatch[] = []

  for (const id of topoOrder) {
    const task = taskById.get(id)
    if (!task) continue

    if (isTerminalStatus(task.status, statuses)) continue

    const deps = predecessorsOf.get(id) ?? []
    if (deps.length === 0) continue

    // Latest due among unarchived predecessors; `latestPlannedDue` is the same
    // date had every one of them finished on plan.
    let latestDue = ''
    let latestPlannedDue = ''
    for (const depId of deps) {
      const dep = taskById.get(depId)
      if (dep?.archived) continue
      const depDue = dueOf.get(depId) ?? ''
      if (!depDue) continue
      if (!latestDue || depDue > latestDue) latestDue = depDue
      const plannedDue = addDays(depDue, daysSavedBy.get(depId) ?? 0)
      if (!latestPlannedDue || plannedDue > latestPlannedDue) latestPlannedDue = plannedDue
    }
    if (!latestDue) continue

    const earliestStart = addDays(latestDue, 1)
    const daysSaved = daysBetween(latestDue, latestPlannedDue)
    const currentStart = startOf.get(id) ?? ''
    const currentDue = dueOf.get(id) ?? ''

    const pullBy = (anchor: string) => Math.min(daysSaved, Math.max(0, daysBetween(earliestStart, anchor)))

    let newStart = currentStart
    let newDue = currentDue
    let pulled = 0

    const isMilestone = task.type === 'milestone' || (!currentStart && currentDue)

    if (isMilestone) {
      // A milestone has no span, so its due date moves instead of its start.
      if (!currentDue || currentDue < earliestStart) {
        newDue = earliestStart
      } else if (daysSaved > 0) {
        pulled = pullBy(currentDue)
        newDue = addDays(currentDue, -pulled)
      }
    } else if (currentStart && currentDue) {
      if (currentStart < earliestStart) {
        // Both ends are inclusive, so the span is one day longer than the gap.
        const duration = daysBetween(currentStart, currentDue) + 1
        newStart = earliestStart
        newDue = addDays(earliestStart, duration - 1)
      } else if (daysSaved > 0) {
        pulled = pullBy(currentStart)
        newStart = addDays(currentStart, -pulled)
        newDue = addDays(currentDue, -pulled)
      }
    } else if (currentStart && !currentDue) {
      if (currentStart < earliestStart) {
        newStart = earliestStart
      } else if (daysSaved > 0) {
        pulled = pullBy(currentStart)
        newStart = addDays(currentStart, -pulled)
      }
    } else {
      newStart = earliestStart
    }

    if (newStart !== currentStart || newDue !== currentDue) {
      startOf.set(id, newStart)
      dueOf.set(id, newDue)
      if (pulled > 0) daysSavedBy.set(id, pulled)
      patches.push({ taskId: id, start: newStart, due: newDue })
    }
  }

  return { patches, cycles }
}

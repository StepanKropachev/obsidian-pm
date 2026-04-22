import { Task, StatusConfig } from '../types'
import { flattenTasks } from './TaskTreeOps'
import { isTerminalStatus } from '../utils'
import { Temporal } from '../dates'

/* ── Types ─────────────────────────────────────────────────────── */

export interface SchedulePatch {
  taskId: string
  start: string // YYYY-MM-DD
  due: string // YYYY-MM-DD
}

export interface ScheduleResult {
  patches: SchedulePatch[]
  cycles: string[][] // groups of task IDs forming cycles
}

/* ── Date helpers ──────────────────────────────────────────────── */

/** Number of calendar days between two YYYY-MM-DD strings. */
export function daysBetween(a: string, b: string): number {
  return Temporal.PlainDate.from(b).since(Temporal.PlainDate.from(a), { largestUnit: 'days' }).days
}

/** Add `n` days to a YYYY-MM-DD string. */
export function addDays(date: string, n: number): string {
  return Temporal.PlainDate.from(date).add({ days: n }).toString()
}

/* ── Cycle detection helper (for dependency-add UI) ───────────── */

/**
 * Returns true if adding an edge `from → to` would create a cycle
 * in the dependency graph.
 * "from depends on to" means there is an edge to → from in scheduling terms,
 * so a cycle exists if `from` can already reach `to` via existing edges.
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
  // BFS from `fromId` along dependent edges — can we reach `toId`?
  const visited = new Set<string>()
  const queue = [fromId]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (current === toId) return true
    if (visited.has(current)) continue
    visited.add(current)
    for (const next of dependentsOf.get(current) ?? []) {
      queue.push(next)
    }
  }
  return false
}

/* ── Main scheduling algorithm ─────────────────────────────────── */

/**
 * Compute schedule patches for tasks based on their dependency graph.
 *
 * When `changedTaskId` is provided, only the downstream dependents of that
 * task are re-scheduled (scoped subtree). Otherwise all tasks are considered.
 *
 * Tasks with status `done` or `cancelled` are skipped — their dates are
 * historically meaningful and should not move.
 */
export function computeSchedule(tasks: Task[], changedTaskId?: string, statuses: StatusConfig[] = []): ScheduleResult {
  const flat = flattenTasks(tasks).map((ft) => ft.task)
  const taskById = new Map<string, Task>()
  const dependentsOf = new Map<string, string[]>() // depId → [taskIds that depend on it]
  const predecessorsOf = new Map<string, string[]>() // taskId → [depIds]

  for (const t of flat) {
    taskById.set(t.id, t)
  }

  // Build adjacency — skip missing IDs
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

  // Scope to affected subtree when changedTaskId provided
  let scopeIds: Set<string> | null = null
  if (changedTaskId) {
    scopeIds = new Set<string>()
    const queue = [changedTaskId]
    while (queue.length > 0) {
      const id = queue.shift()!
      if (scopeIds.has(id)) continue
      scopeIds.add(id)
      for (const depId of dependentsOf.get(id) ?? []) {
        queue.push(depId)
      }
    }
  }

  // Kahn's algorithm for topological sort + cycle detection
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
    const id = queue.shift()!
    topoOrder.push(id)
    for (const depId of dependentsOf.get(id) ?? []) {
      if (!inDegree.has(depId)) continue
      const newDeg = inDegree.get(depId)! - 1
      inDegree.set(depId, newDeg)
      if (newDeg === 0) queue.push(depId)
    }
  }

  // Collect cycles — IDs not in topoOrder
  const sortedSet = new Set(topoOrder)
  const cycleIds = relevantIds.filter((id) => !sortedSet.has(id))
  const cycles: string[][] = cycleIds.length > 0 ? [cycleIds] : []

  // Forward-pass scheduling in topological order
  // We work with a mutable copy of dates so cascading works within this run
  const startOf = new Map<string, string>()
  const dueOf = new Map<string, string>()
  for (const t of flat) {
    startOf.set(t.id, t.start)
    dueOf.set(t.id, t.due)
  }

  const patches: SchedulePatch[] = []

  for (const id of topoOrder) {
    const task = taskById.get(id)!

    // Skip done/cancelled tasks
    if (isTerminalStatus(task.status, statuses)) continue

    const deps = predecessorsOf.get(id) ?? []
    if (deps.length === 0) continue

    // Find latest due among predecessors that have a due date
    // Skip archived predecessors — they are hidden from the UI
    let latestDue = ''
    for (const depId of deps) {
      const dep = taskById.get(depId)
      if (dep?.archived) continue
      const depDue = dueOf.get(depId) ?? ''
      if (depDue && (!latestDue || depDue > latestDue)) {
        latestDue = depDue
      }
    }
    if (!latestDue) continue // no predecessors with due dates

    const earliestStart = addDays(latestDue, 1)
    const currentStart = startOf.get(id) ?? ''
    const currentDue = dueOf.get(id) ?? ''

    let newStart = currentStart
    let newDue = currentDue

    const isMilestone = task.type === 'milestone' || (!currentStart && currentDue)

    if (isMilestone) {
      // Milestone: shift due instead of start
      if (!currentDue || currentDue < earliestStart) {
        newDue = earliestStart
      }
    } else if (currentStart && currentDue) {
      // Has both: preserve duration, shift if needed
      if (currentStart < earliestStart) {
        // Duration spans from currentStart to currentDue (both inclusive)
        // so the number of days is daysBetween + 1
        const duration = daysBetween(currentStart, currentDue) + 1
        newStart = earliestStart
        newDue = addDays(earliestStart, duration - 1)
      }
    } else if (!currentStart && currentDue) {
      // Has only due: shift due if needed (treat as milestone)
      if (currentDue < earliestStart) {
        newDue = earliestStart
      }
    } else if (currentStart && !currentDue) {
      // Start only: shift start if needed
      if (currentStart < earliestStart) {
        newStart = earliestStart
      }
    } else {
      // Neither start nor due: set start
      newStart = earliestStart
    }

    if (newStart !== currentStart || newDue !== currentDue) {
      // Update mutable maps for cascading
      startOf.set(id, newStart)
      dueOf.set(id, newDue)
      patches.push({ taskId: id, start: newStart, due: newDue })
    }
  }

  return { patches, cycles }
}

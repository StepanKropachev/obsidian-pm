// Analysis verbs (INT-019 §B): read-only graph/schedule/integrity reporting.
// Every handler resolves its scope through the store and CONSUMES the pure
// helpers (`computeSchedule`, `directDependents`, `findTaskFileConflict`) — no
// scheduling, cycle-detection, or palette rules are re-implemented here. Each
// returns a normalized `ViewSpec` alongside its JSON `data`.

import type { Project, StatusConfig, Task } from '../../../src/types'
import { computeSchedule, findTaskById, flattenTasks } from '../../../src/store'
import { parsePlainDate, today } from '../../../src/dates'
import type { PmContext } from '../PmContext'
import { resolveProjectRef } from '../handles'
import { PmError, type HandlerOutput } from '../envelope'
import type { ParsedCommand } from '../args'
import { flagBool, flagStr } from '../args'
import { statusGlyph, statusLegend, type ViewRow, type ViewSpec } from '../render'
import { directDependents, isComplete } from '../schedule'

function statusesOf(ctx: PmContext, project: Project): StatusConfig[] {
  return ctx.store.configFor(project).statuses
}

/** Whole-day span from `start`→`due` (0 when either is unset). */
function durationDays(start: string | undefined, due: string | undefined): number {
  if (!start || !due) return 0
  const a = parsePlainDate(start)
  const b = parsePlainDate(due)
  if (!a || !b) return 0
  const d = a.until(b, { largestUnit: 'day' }).days
  return d > 0 ? d : 0
}

// ─── graph ────────────────────────────────────────────────────────────────────

interface Edge {
  from: string
  to: string
}

/** Every dependency edge (`task → dep`) whose endpoints both resolve in-project. */
function dependencyEdges(project: Project): Edge[] {
  const edges: Edge[] = []
  for (const f of flattenTasks(project.tasks)) {
    for (const depId of f.task.dependencies) {
      if (findTaskById(project, depId)) edges.push({ from: f.task.id, to: depId })
    }
  }
  return edges
}

export async function graph(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const ref = cmd.positionals[0] ?? flagStr(cmd.flags, 'project')
  if (!ref) throw new PmError('E_USAGE', 'graph requires a project')
  const all = await ctx.store.discoverProjects()
  const project = resolveProjectRef(all, ref)
  const nodes = flattenTasks(project.tasks).map((f) => f.task)
  const edges = dependencyEdges(project)

  // `--dot` — a Graphviz DOT document (nodes labelled by title, then edges).
  if (flagBool(cmd.flags, 'dot')) {
    const lines: string[] = [`digraph "${project.title.replace(/"/g, '\\"')}" {`]
    for (const t of nodes) lines.push(`  "${t.id}" [label="${t.title.replace(/"/g, '\\"')}"]`)
    for (const e of edges) lines.push(`  "${e.from}" -> "${e.to}"`)
    lines.push('}')
    const dot = lines.join('\n')
    return {
      data: { project: project.id, nodes: nodes.map((t) => t.id), edges, dot },
      view: { format: 'plain', text: dot }
    }
  }

  // Default — a table of `from → to` edges.
  const statuses = statusesOf(ctx, project)
  const columns = ['from', 'to', 'edge']
  const rows: ViewRow[] = edges.map((e) => {
    const fromT = findTaskById(project, e.from)
    const toT = findTaskById(project, e.to)
    return {
      depth: 0,
      title: `${fromT?.title ?? e.from} → ${toT?.title ?? e.to}`,
      cols: {
        from: e.from,
        to: e.to,
        edge: `${statusGlyph(fromT?.status ?? '', statuses)} ${fromT?.title ?? e.from} → ${toT?.title ?? e.to}`
      }
    }
  })
  return {
    data: { project: project.id, nodes: nodes.map((t) => t.id), edges },
    view: {
      format: 'table',
      legend: statusLegend(),
      columns,
      rows,
      footer: `${nodes.length} node${nodes.length === 1 ? '' : 's'} · ${edges.length} edge${edges.length === 1 ? '' : 's'}`
    }
  }
}

// ─── critical-path ──────────────────────────────────────────────────────────

export async function criticalPath(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const ref = cmd.positionals[0] ?? flagStr(cmd.flags, 'project')
  if (!ref) throw new PmError('E_USAGE', 'critical-path requires a project')
  const all = await ctx.store.discoverProjects()
  const project = resolveProjectRef(all, ref)
  const statuses = statusesOf(ctx, project)
  const flat = flattenTasks(project.tasks).map((f) => f.task)
  const byId = new Map(flat.map((t) => [t.id, t]))

  // Consume the scheduler's dates (do NOT re-schedule): overlay its patches on
  // each task's own start/due, then derive a per-task duration.
  const { patches } = computeSchedule(project.tasks, undefined, statuses)
  const startOf = new Map<string, string>()
  const dueOf = new Map<string, string>()
  for (const t of flat) {
    startOf.set(t.id, t.start)
    dueOf.set(t.id, t.due)
  }
  for (const p of patches) {
    startOf.set(p.taskId, p.start)
    dueOf.set(p.taskId, p.due)
  }
  const durationOf = (id: string): number => durationDays(startOf.get(id), dueOf.get(id))

  // Longest-total-duration path through the dependency DAG (cycle-guarded memo).
  const best = new Map<string, number>()
  const nextOf = new Map<string, string | null>()
  const visiting = new Set<string>()
  const compute = (id: string): number => {
    const cached = best.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) return durationOf(id) // cycle: stop descending
    visiting.add(id)
    const task = byId.get(id)
    let bestDep = -1
    let bestDepId: string | null = null
    for (const depId of task?.dependencies ?? []) {
      if (!byId.has(depId)) continue
      const v = compute(depId)
      if (v > bestDep) {
        bestDep = v
        bestDepId = depId
      }
    }
    visiting.delete(id)
    const total = durationOf(id) + (bestDep >= 0 ? bestDep : 0)
    best.set(id, total)
    nextOf.set(id, bestDepId)
    return total
  }
  for (const t of flat) compute(t.id)

  // Pick the head with the greatest total, then walk `nextOf` to the deepest dep.
  let headId: string | null = null
  let headBest = -1
  for (const t of flat) {
    const v = best.get(t.id) ?? 0
    if (v > headBest) {
      headBest = v
      headId = t.id
    }
  }
  const chainDesc: string[] = []
  const seen = new Set<string>()
  let cur = headId
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    chainDesc.push(cur)
    cur = nextOf.get(cur) ?? null
  }
  // Present earliest → latest (dependencies first).
  const chain = [...chainDesc].reverse()

  const rows: ViewRow[] = chain.map((id, i) => {
    const t = byId.get(id)!
    return {
      id,
      depth: i,
      glyph: statusGlyph(t.status, statuses),
      status: t.status,
      type: t.type,
      title: t.title,
      due: dueOf.get(id) || undefined
    }
  })
  const totalDays = headId !== null ? Math.max(headBest, 0) : 0
  return {
    data: { project: project.id, path: chain, total_duration_days: totalDays },
    view: {
      format: 'lineage',
      legend: statusLegend(),
      header: `critical path (${project.title})`,
      rows,
      footer: chain.length
        ? `${chain.length} task${chain.length === 1 ? '' : 's'} · ${totalDays} day${totalDays === 1 ? '' : 's'} total`
        : 'no tasks'
    }
  }
}

// ─── blockers ─────────────────────────────────────────────────────────────────

/** Count of tasks that transitively depend on `taskId` within its project. */
function transitiveBlockedCount(project: Project, taskId: string): number {
  const seen = new Set<string>()
  const stack = directDependents(project, taskId).map((t) => t.id)
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const d of directDependents(project, id)) stack.push(d.id)
  }
  return seen.size
}

export async function blockers(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const ref = cmd.positionals[0] ?? flagStr(cmd.flags, 'project')
  const all = await ctx.store.discoverProjects()
  const scope = ref ? [resolveProjectRef(all, ref)] : all
  const multi = scope.length > 1

  interface Ranked {
    project: Project
    task: Task
    count: number
  }
  const ranked: Ranked[] = []
  for (const project of scope) {
    for (const f of flattenTasks(project.tasks)) {
      if (f.task.archived) continue
      const count = transitiveBlockedCount(project, f.task.id)
      if (count > 0) ranked.push({ project, task: f.task, count })
    }
  }
  ranked.sort((a, b) => b.count - a.count || a.task.title.localeCompare(b.task.title))

  const columns = multi ? ['project', 'id', 'blocks', 'status', 'title'] : ['id', 'blocks', 'status', 'title']
  const rows: ViewRow[] = ranked.map(({ project, task, count }) => ({
    depth: 0,
    title: task.title,
    cols: {
      project: project.id,
      id: task.id,
      blocks: String(count),
      status: task.status,
      title: task.title
    }
  }))
  return {
    data: { blockers: ranked.map((r) => ({ id: r.task.id, project: r.project.id, blocks: r.count })) },
    view: {
      format: 'table',
      columns,
      rows,
      footer: `${ranked.length} blocking task${ranked.length === 1 ? '' : 's'}`
    }
  }
}

// ─── validate ───────────────────────────────────────────────────────────────

interface Finding {
  project: string
  category: string
  id: string
  detail: string
}

export async function validate(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const ref = cmd.positionals[0] ?? flagStr(cmd.flags, 'project')
  const fix = flagBool(cmd.flags, 'fix')
  const all = await ctx.store.discoverProjects()
  const scope = ref ? [resolveProjectRef(all, ref)] : all

  const findings: Finding[] = []
  const changed: string[] = []

  for (const project of scope) {
    const statuses = statusesOf(ctx, project)
    const priorities = ctx.store.configFor(project).priorities
    const statusIds = new Set(statuses.map((s) => s.id))
    const priorityIds = new Set(priorities.map((p) => p.id))
    const flat = flattenTasks(project.tasks)
    const idCounts = new Map<string, number>()
    for (const f of flat) idCounts.set(f.task.id, (idCounts.get(f.task.id) ?? 0) + 1)

    for (const f of flat) {
      const t = f.task
      // Unknown palette values.
      if (!statusIds.has(t.status)) findings.push({ project: project.id, category: 'unknown-status', id: t.id, detail: t.status })
      if (!priorityIds.has(t.priority)) findings.push({ project: project.id, category: 'unknown-priority', id: t.id, detail: t.priority })
      // Dangling dependency ids.
      for (const depId of t.dependencies) {
        if (!findTaskById(project, depId)) findings.push({ project: project.id, category: 'dangling-dependency', id: t.id, detail: depId })
      }
      // Duplicate ids (integrity / misparent hazard).
      if ((idCounts.get(t.id) ?? 0) > 1) findings.push({ project: project.id, category: 'duplicate-id', id: t.id, detail: `appears ${idCounts.get(t.id)}×` })
      // Missing note file.
      if (!t.filePath || !ctx.vault.getAbstractFileByPath(t.filePath)) findings.push({ project: project.id, category: 'missing-file', id: t.id, detail: t.filePath ?? '(none)' })
      // Filename collision (would collide on save).
      const conflict = ctx.store.findTaskFileConflict(project, t)
      if (conflict) findings.push({ project: project.id, category: 'filename-collision', id: t.id, detail: conflict.message })
    }

    // Orphan / misparent: a task whose recorded parent is not present in-tree.
    for (const f of flat) {
      if (f.parentId && !findTaskById(project, f.parentId)) {
        findings.push({ project: project.id, category: 'orphan', id: f.task.id, detail: `parent ${f.parentId} missing` })
      }
    }

    // Dependency cycles (the scheduler is the authority).
    const { cycles } = computeSchedule(project.tasks, undefined, statuses)
    for (const cycle of cycles) {
      findings.push({ project: project.id, category: 'cycle', id: cycle[0] ?? '', detail: cycle.join(' → ') })
    }

    // `--fix`: persist the store's on-load self-heal by rewriting the project.
    if (fix) {
      await ctx.store.saveProject(project)
      changed.push(project.id)
    }
  }

  const columns = ['project', 'category', 'id', 'detail']
  const rows: ViewRow[] = findings.map((f) => ({
    depth: 0,
    title: f.detail,
    cols: { project: f.project, category: f.category, id: f.id, detail: f.detail }
  }))
  const byCategory: Record<string, number> = {}
  for (const f of findings) byCategory[f.category] = (byCategory[f.category] ?? 0) + 1
  return {
    data: { findings, counts: byCategory, fixed: fix },
    changed_ids: changed,
    view: {
      format: 'table',
      columns,
      rows,
      footer: findings.length
        ? `${findings.length} finding${findings.length === 1 ? '' : 's'}${fix ? ' · self-heal written' : ''}`
        : 'no findings — clean'
    }
  }
}

// ─── rollup ───────────────────────────────────────────────────────────────────

type GroupKey = 'status' | 'assignee' | 'priority'

export async function rollup(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const ref = cmd.positionals[0] ?? flagStr(cmd.flags, 'project')
  if (!ref) throw new PmError('E_USAGE', 'rollup requires a project')
  const groupBy = flagStr(cmd.flags, 'group-by') as GroupKey | undefined
  if (!groupBy || !['status', 'assignee', 'priority'].includes(groupBy)) {
    throw new PmError('E_USAGE', 'rollup requires --group-by status|assignee|priority')
  }
  const all = await ctx.store.discoverProjects()
  const project = resolveProjectRef(all, ref)
  const statuses = statusesOf(ctx, project)
  const iso = today().toString()

  interface Agg {
    count: number
    done: number
    overdue: number
    estimate: number
  }
  const groups = new Map<string, Agg>()
  const bump = (key: string, task: Task): void => {
    const agg = groups.get(key) ?? { count: 0, done: 0, overdue: 0, estimate: 0 }
    agg.count += 1
    if (isComplete(task, statuses)) agg.done += 1
    else if (task.due && task.due < iso) agg.overdue += 1
    agg.estimate += task.timeEstimate ?? 0
    groups.set(key, agg)
  }

  for (const f of flattenTasks(project.tasks)) {
    if (f.task.archived) continue
    if (groupBy === 'assignee') {
      const people = f.task.assignees.length ? f.task.assignees : ['(unassigned)']
      for (const p of people) bump(p, f.task)
    } else {
      bump(f.task[groupBy], f.task)
    }
  }

  const columns = [groupBy, 'count', 'done', 'pct', 'overdue', 'est']
  const rows: ViewRow[] = []
  const data: Record<string, unknown>[] = []
  for (const [key, agg] of groups) {
    const pct = agg.count ? Math.round((agg.done / agg.count) * 100) : 0
    rows.push({
      depth: 0,
      title: key,
      cols: {
        [groupBy]: key,
        count: String(agg.count),
        done: String(agg.done),
        pct: `${pct}%`,
        overdue: String(agg.overdue),
        est: agg.estimate ? String(agg.estimate) : '·'
      }
    })
    data.push({ group: key, count: agg.count, done: agg.done, percentComplete: pct, overdue: agg.overdue, timeEstimate: agg.estimate })
  }
  rows.sort((a, b) => Number(b.cols!.count) - Number(a.cols!.count))
  return {
    data: { project: project.id, groupBy, groups: data },
    view: {
      format: 'table',
      columns,
      rows,
      footer: `${groups.size} group${groups.size === 1 ? '' : 's'} by ${groupBy}`
    }
  }
}

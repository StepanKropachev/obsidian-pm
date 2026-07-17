// Read / navigation verbs. Every handler delegates computation to the store /
// pure tree ops and returns BOTH a JSON `data` payload and a normalized `view`
// (ViewSpec) that the renderer turns into the default agent-legible printout.
// No handler mutates the vault.

import { TFile } from 'obsidian'
import type { Project, StatusConfig, Task } from '../../../src/types'
import { findTaskById, flattenTasks } from '../../../src/store'
import { parsePlainDate } from '../../../src/dates'
import type { PmContext } from '../PmContext'
import { resolveHandle, resolveProjectRef } from '../handles'
import { PmError, type HandlerOutput } from '../envelope'
import type { ParsedCommand } from '../args'
import { flagBool, flagList, flagNum, flagStr } from '../args'
import {
  LEGEND,
  buildTreeNodes,
  contentLinesOf,
  lineageOf,
  projectContentLinesOf,
  statusGlyph,
  statusLegend,
  type LegendEntry,
  type LineageEntry,
  type ViewRow,
  type ViewSection,
  type ViewSpec
} from '../render'
import { directDependents, isComplete, unmetDeps } from '../schedule'

interface Located {
  project: Project
  task: Task
  parentId: string | null
}

// ─── shared helpers ─────────────────────────────────────────────────────────

/** Every non-archived task across every project, with its project + parent. */
function allTasks(projects: Project[], includeArchived = false): Located[] {
  const out: Located[] = []
  for (const project of projects) {
    for (const f of flattenTasks(project.tasks)) {
      if (f.task.archived && !includeArchived) continue
      out.push({ project, task: f.task, parentId: f.parentId })
    }
  }
  return out
}

function statusesOf(ctx: PmContext, project: Project): StatusConfig[] {
  return ctx.store.configFor(project).statuses
}

/** Whole days by which `due` precedes `iso` (0 if not before). */
function daysOverdue(due: string, iso: string): number {
  const a = parsePlainDate(due)
  const b = parsePlainDate(iso)
  if (!a || !b) return 0
  const d = a.until(b, { largestUnit: 'day' }).days
  return d > 0 ? d : 0
}

/** `N/M done` over a task's descendants, or undefined if it has none. */
function progressOf(task: Task, statuses: StatusConfig[]): string | undefined {
  const all = flattenTasks(task.subtasks ?? [])
  if (!all.length) return undefined
  const done = all.filter((f) => isComplete(f.task, statuses)).length
  return `${done}/${all.length} done`
}

function childCountOf(task: Task): number {
  return task.subtasks?.length ?? 0
}

/** Build a rendered ViewRow for a task at a given lineage depth. Structured
 *  fields are ALWAYS populated (faithful porcelain/ndjson); pretty display of
 *  assignees/priority is gated by the view's `rich` flag in the renderer. */
async function taskRow(
  ctx: PmContext,
  project: Project,
  task: Task,
  depth: number,
  opts: { iso?: string; showOverdue?: boolean; showDue?: boolean; showBlocked?: boolean; rel?: 'sub' | 'needs' | 'blocks' } = {}
): Promise<ViewRow> {
  const statuses = statusesOf(ctx, project)
  const unmet = unmetDeps(project, task, statuses)
  const childCount = childCountOf(task)
  const overdueDays =
    opts.showOverdue && opts.iso && task.due && task.due < opts.iso ? daysOverdue(task.due, opts.iso) : undefined
  return {
    id: task.id,
    depth,
    glyph: statusGlyph(task.status, statuses),
    status: task.status,
    type: task.type,
    title: task.title,
    due: opts.showDue === false ? undefined : task.due || undefined,
    contentLines: await contentLinesOf(ctx, task),
    childCount,
    overdueDays,
    progress: childCount > 0 ? progressOf(task, statuses) : undefined,
    blockedBy: opts.showBlocked !== false && unmet.length ? unmet : undefined,
    assignees: task.assignees?.length ? task.assignees : undefined,
    priority: task.priority,
    rel: opts.rel
  }
}

const pathKey = (lin: LineageEntry[], task: Task): string => [...lin.map((e) => e.id), task.id].join('/')

/**
 * Lineage-shaped rows: each project a header (depth 0), each context ancestor a
 * header at its depth, each target task a glyph row at `lineage.length`. Ancestors
 * that are themselves targets render as glyph rows (depth-ascending), not headers.
 */
async function shapeLineage(
  ctx: PmContext,
  located: Located[],
  opts: { iso?: string; showOverdue?: boolean } = {}
): Promise<ViewRow[]> {
  const targetIds = new Set(located.map((l) => l.task.id))
  // group by project, preserving first-seen order
  const groups = new Map<string, { project: Project; items: { task: Task; lin: LineageEntry[] }[] }>()
  for (const { project, task } of located) {
    if (!groups.has(project.id)) groups.set(project.id, { project, items: [] })
    groups.get(project.id)!.items.push({ task, lin: lineageOf(project, task) })
  }
  const rows: ViewRow[] = []
  for (const { project, items } of groups.values()) {
    rows.push({ depth: 0, isHeader: true, id: project.id, title: project.title })
    // Pre-order (DFS) by full lineage path so every child renders directly under
    // its own ancestor, never after an unrelated shallower sibling. A parent's
    // path is a prefix of its child's, so prefixes sort first — parents precede
    // children and each subtree stays contiguous.
    items.sort((a, b) => pathKey(a.lin, a.task).localeCompare(pathKey(b.lin, b.task)))
    const emitted = new Set<string>()
    for (const { task, lin } of items) {
      for (let i = 1; i < lin.length; i++) {
        const anc = lin[i]!
        if (targetIds.has(anc.id) || emitted.has(anc.id)) continue
        emitted.add(anc.id)
        rows.push({ depth: i, isHeader: true, id: anc.id, title: anc.title })
      }
      rows.push(await taskRow(ctx, project, task, lin.length, { ...opts, showOverdue: opts.showOverdue, showBlocked: true }))
      emitted.add(task.id)
    }
  }
  return rows
}

const lineageLegend = (): LegendEntry[] => [...statusLegend(), LEGEND.notes!, LEGEND.children!]

// ─── projects ───────────────────────────────────────────────────────────────

/**
 * `--fields a,b,c` trims each JSON payload object to the requested keys (token
 * economy). Applies to the `--json` data only — never reshapes porcelain columns
 * (those stay faithful per the frozen render grammar).
 */
function pickFields<T extends object>(items: readonly T[], fields: string[]): (T | Record<string, unknown>)[] {
  if (!fields.length) return [...items]
  return items.map((it) => {
    const rec = it as Record<string, unknown>
    const o: Record<string, unknown> = {}
    for (const f of fields) if (f in rec) o[f] = rec[f]
    return o
  })
}

export async function projects(ctx: PmContext, cmd?: ParsedCommand): Promise<HandlerOutput> {
  const fields = cmd ? flagList(cmd.flags, 'fields') : []
  const all = await ctx.store.discoverProjects()
  const columns = ['id', 'status', 'tasks', 'notes', 'title']
  const rows: ViewRow[] = []
  const data: Record<string, unknown>[] = []
  for (const p of all) {
    const count = flattenTasks(p.tasks).length
    const notes = await projectContentLinesOf(ctx, p)
    rows.push({
      depth: 0,
      title: p.title,
      cols: {
        id: p.id,
        status: 'project',
        tasks: String(count),
        notes: notes > 0 ? `✎${notes}` : '·',
        title: p.title
      }
    })
    data.push({ id: p.id, title: p.title, filePath: p.filePath, path: p.path ?? '', taskCount: count, noteLines: notes })
  }
  return {
    data: { projects: pickFields(data, fields) },
    view: {
      format: 'table',
      columns,
      rows,
      footer: `${all.length} project${all.length === 1 ? '' : 's'}`
    }
  }
}

// ─── tree (universal + composable) ──────────────────────────────────────────

async function upstreamRows(
  ctx: PmContext,
  project: Project,
  task: Task,
  transitive: boolean
): Promise<ViewRow[]> {
  const rows: ViewRow[] = []
  const seen = new Set<string>()
  const walk = async (t: Task, depth: number): Promise<void> => {
    for (const depId of t.dependencies ?? []) {
      if (seen.has(depId)) continue
      seen.add(depId)
      const dep = findTaskById(project, depId)
      if (!dep) continue
      rows.push(await taskRow(ctx, project, dep, depth, {}))
      if (transitive) await walk(dep, depth + 1)
    }
  }
  await walk(task, 1)
  return rows
}

async function downstreamRows(
  ctx: PmContext,
  project: Project,
  task: Task,
  transitive: boolean
): Promise<ViewRow[]> {
  const rows: ViewRow[] = []
  const seen = new Set<string>()
  const walk = async (id: string, depth: number): Promise<void> => {
    for (const dep of directDependents(project, id)) {
      if (seen.has(dep.id)) continue
      seen.add(dep.id)
      rows.push(await taskRow(ctx, project, dep, depth, {}))
      if (transitive) await walk(dep.id, depth + 1)
    }
  }
  await walk(task.id, 1)
  return rows
}

export async function tree(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const handle = cmd.positionals[0]
  if (!handle) throw new PmError('E_USAGE', 'tree requires a handle')
  const all = await ctx.store.discoverProjects()
  const located = resolveHandle(all, handle)
  const depth = flagNum(cmd.flags, 'depth')
  const rich = flagBool(cmd.flags, 'rich')
  const transitive = flagBool(cmd.flags, 'transitive')
  const includeArchived = flagBool(cmd.flags, 'include-archived')
  const fields = flagList(cmd.flags, 'fields')
  const treeOpts = { depth, includeArchived }

  const wantNeeds = flagBool(cmd.flags, 'needs') || flagBool(cmd.flags, 'all')
  const wantBlocks = flagBool(cmd.flags, 'blocks') || flagBool(cmd.flags, 'all')
  const wantSub = flagBool(cmd.flags, 'sub') || flagBool(cmd.flags, 'all') || (!wantNeeds && !wantBlocks)

  const project = located.project
  const statuses = statusesOf(ctx, project)
  const legend = lineageLegend()

  // Root header line.
  let rootRow: ViewRow
  if (located.kind === 'project') {
    const notes = await projectContentLinesOf(ctx, project)
    rootRow = {
      depth: 0,
      id: project.id,
      title: project.title,
      contentLines: notes,
      childCount: project.tasks.length
    }
  } else {
    rootRow = await taskRow(ctx, project, located.task, 0, { showBlocked: true })
  }

  // Single-section (sub-only) → a flat lineage list including the root.
  const root = located.kind === 'task' ? located.task : null
  if (wantSub && !wantNeeds && !wantBlocks) {
    const nodes = await buildTreeNodes(ctx, project, root, treeOpts)
    const rows: ViewRow[] = [rootRow]
    for (const n of nodes) {
      if (root && n.id === root.id) continue // buildTreeNodes includes root for a task; skip dup
      const task = findTaskById(project, n.id)
      if (!task) continue
      const nodeDepth = root ? n.depth : n.depth + 1 // children start one level under the root row
      rows.push(await taskRow(ctx, project, task, nodeDepth, { rel: 'sub' }))
    }
    return {
      data: { root: located.kind === 'project' ? project.id : located.task.id, nodes: pickFields(nodes, fields) },
      view: { format: 'lineage', legend, rich, rows }
    }
  }

  // Multi-section (needs/blocks, optionally with sub).
  const sections: ViewSection[] = []
  if (wantSub) {
    const nodes = await buildTreeNodes(ctx, project, root, treeOpts)
    const rows: ViewRow[] = []
    for (const n of nodes) {
      if (root && n.id === root.id) continue
      const task = findTaskById(project, n.id)
      if (task) rows.push(await taskRow(ctx, project, task, Math.max(n.depth, 1), { rel: 'sub' }))
    }
    if (rows.length) sections.push({ label: 'subtasks', rel: 'sub', rows })
  }
  if (wantNeeds && root) {
    const rows = await upstreamRows(ctx, project, root, transitive)
    sections.push({ label: 'needs (must finish first)', rel: 'needs', rows })
  }
  if (wantBlocks && root) {
    const rows = await downstreamRows(ctx, project, root, transitive)
    sections.push({ label: 'blocks (waiting on this)', rel: 'blocks', rows })
  }
  return {
    data: { root: located.kind === 'project' ? project.id : located.task.id },
    view: { format: 'graph', legend, rich, header: renderRootHeader(rootRow, statuses), sections }
  }
}

/** A compact one-line header for the item a graph view is rooted at. */
function renderRootHeader(row: ViewRow, _statuses: StatusConfig[]): string {
  const parts: string[] = []
  if (row.glyph) parts.push(row.glyph)
  if (row.id) parts.push(`[${row.id}]`)
  parts.push(row.title)
  return parts.join(' ')
}

// ─── today ──────────────────────────────────────────────────────────────────

export async function todayCmd(ctx: PmContext): Promise<HandlerOutput> {
  const all = await ctx.store.discoverProjects()
  const iso = ctx.now
  const due: Located[] = []
  let overdueCount = 0
  for (const loc of allTasks(all)) {
    const statuses = statusesOf(ctx, loc.project)
    if (isComplete(loc.task, statuses)) continue
    if (loc.task.due === iso) due.push(loc)
    else if (loc.task.due && loc.task.due < iso) overdueCount++
  }
  const rows = await shapeLineage(ctx, due, { iso })
  const projectCount = new Set(due.map((l) => l.project.id)).size
  const warning = overdueCount > 0 ? `⚠ ${overdueCount} overdue — pm overdue` : undefined
  return {
    data: { today: iso, items: due.map((l) => l.task.id), overdue: overdueCount },
    view: {
      format: 'lineage',
      warning,
      legend: lineageLegend(),
      header: `today = ${iso}`,
      rows,
      footer: `${projectCount} project${projectCount === 1 ? '' : 's'} · ${due.length} due today`
    }
  }
}

// ─── overdue ──────────────────────────────────────────────────────────────────

export async function overdueCmd(ctx: PmContext): Promise<HandlerOutput> {
  const all = await ctx.store.discoverProjects()
  const iso = ctx.now
  const items = allTasks(all).filter(
    ({ project, task }) => task.due && task.due < iso && !isComplete(task, statusesOf(ctx, project))
  )
  const rows = await shapeLineage(ctx, items, { iso, showOverdue: true })
  const projectCount = new Set(items.map((l) => l.project.id)).size
  const legend = [...lineageLegend(), { symbol: '!Nd', meaning: 'overdue by N days' }]
  return {
    data: { today: iso, items: items.map((l) => l.task.id) },
    view: {
      format: 'lineage',
      legend,
      header: `today = ${iso}`,
      rows,
      footer: `${items.length} overdue across ${projectCount} project${projectCount === 1 ? '' : 's'}`
    }
  }
}

// ─── open ─────────────────────────────────────────────────────────────────────

export async function open(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const all = await ctx.store.discoverProjects()
  const iso = ctx.now
  let located = allTasks(all).filter(({ project, task }) => !isComplete(task, statusesOf(ctx, project)))
  if (flagStr(cmd.flags, 'by') === 'deps') {
    located = located.sort((a, b) => {
      const ba = unmetDeps(a.project, a.task, statusesOf(ctx, a.project)).length > 0 ? 1 : 0
      const bb = unmetDeps(b.project, b.task, statusesOf(ctx, b.project)).length > 0 ? 1 : 0
      return ba - bb
    })
  }
  const rows = await shapeLineage(ctx, located, { iso, showOverdue: true })
  const blockedCount = located.filter(
    ({ project, task }) => unmetDeps(project, task, statusesOf(ctx, project)).length > 0
  ).length
  return {
    data: { items: located.map((l) => l.task.id), blocked: blockedCount },
    view: {
      format: 'lineage',
      legend: lineageLegend(),
      header: `today = ${iso}`,
      rows,
      footer: `${located.length} open · ${blockedCount} blocked`
    }
  }
}

// ─── blocked ──────────────────────────────────────────────────────────────────

export async function blocked(ctx: PmContext): Promise<HandlerOutput> {
  const all = await ctx.store.discoverProjects()
  const items = allTasks(all).filter(({ project, task }) => {
    const statuses = statusesOf(ctx, project)
    return !isComplete(task, statuses) && unmetDeps(project, task, statuses).length > 0
  })
  const rows = await shapeLineage(ctx, items, {})
  return {
    data: { items: items.map((l) => l.task.id) },
    view: {
      format: 'lineage',
      legend: lineageLegend(),
      rows,
      footer: `${items.length} blocked`
    }
  }
}

// ─── next ─────────────────────────────────────────────────────────────────────

export async function next(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const all = await ctx.store.discoverProjects()
  const iso = ctx.now
  const frontier: Located[] = []
  for (const loc of allTasks(all)) {
    const statuses = statusesOf(ctx, loc.project)
    if (isComplete(loc.task, statuses)) continue
    if (unmetDeps(loc.project, loc.task, statuses).length > 0) continue
    frontier.push(loc)
  }
  frontier.sort((a, b) => {
    const da = a.task.due ?? ''
    const db = b.task.due ?? ''
    const oa = da && da < iso ? 0 : 1
    const ob = db && db < iso ? 0 : 1
    if (oa !== ob) return oa - ob
    if (da && db) return da.localeCompare(db)
    return da ? -1 : db ? 1 : 0
  })
  const limit = flagNum(cmd.flags, 'limit')
  const chosen = limit !== undefined ? frontier.slice(0, limit) : frontier
  const rows = await shapeLineage(ctx, chosen, { iso, showOverdue: true })
  return {
    data: { items: chosen.map((l) => l.task.id) },
    view: {
      format: 'lineage',
      legend: lineageLegend(),
      rows,
      footer: `${chosen.length} actionable now`
    }
  }
}

// ─── agenda ───────────────────────────────────────────────────────────────────

export async function agenda(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const raw = cmd.positionals[0] ?? ctx.now
  const arg = raw === 'this-week' ? weekRange(ctx.now) : raw
  const [fromStr, toStr] = arg.includes('..') ? arg.split('..') : [arg, arg]
  const from = parsePlainDate(fromStr!)
  const to = parsePlainDate(toStr!)
  if (!from || !to) throw new PmError('E_USAGE', `invalid agenda date/range "${raw}"`)
  const all = await ctx.store.discoverProjects()
  const iso = ctx.now
  const items = allTasks(all).filter(
    ({ task }) => task.due && task.due >= from.toString() && task.due <= to.toString()
  )
  const rows = await shapeLineage(ctx, items, { iso })
  const label = from.toString() === to.toString() ? from.toString() : `${from.toString()}..${to.toString()}`
  return {
    data: { from: from.toString(), to: to.toString(), items: items.map((l) => l.task.id) },
    view: {
      format: 'lineage',
      legend: lineageLegend(),
      header: `agenda ${label}`,
      rows,
      footer: `${items.length} scheduled`
    }
  }
}

function weekRange(iso: string): string {
  const d = parsePlainDate(iso)!
  const monday = d.subtract({ days: (d.dayOfWeek + 6) % 7 })
  const sunday = monday.add({ days: 6 })
  return `${monday.toString()}..${sunday.toString()}`
}

// ─── deps ─────────────────────────────────────────────────────────────────────

export async function deps(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const handle = cmd.positionals[0]
  if (!handle) throw new PmError('E_USAGE', 'deps requires a handle')
  const all = await ctx.store.discoverProjects()
  const located = resolveHandle(all, handle)
  if (located.kind !== 'task') throw new PmError('E_NOT_FOUND', 'deps requires a task handle')
  const { project, task } = located
  const statuses = statusesOf(ctx, project)
  const transitive = flagBool(cmd.flags, 'transitive')

  const needs = await upstreamRows(ctx, project, task, transitive)
  const blocks = await downstreamRows(ctx, project, task, transitive)
  const unmet = unmetDeps(project, task, statuses)
  const rootRow = await taskRow(ctx, project, task, 0, { showBlocked: false })

  const sections: ViewSection[] = []
  sections.push({ label: 'needs (must finish first)', rel: 'needs', rows: needs })
  sections.push({ label: 'blocks (waiting on this)', rel: 'blocks', rows: blocks })
  const warning = unmet.length ? `⚠ blocked: ${unmet.map((i) => `[${i}]`).join(', ')} upstream not done` : undefined
  return {
    data: { id: task.id, depends_on: task.dependencies, blocks: directDependents(project, task.id).map((t) => t.id) },
    view: {
      format: 'graph',
      warning,
      legend: lineageLegend(),
      header: renderRootHeader(rootRow, statuses),
      sections
    }
  }
}

// ─── path ─────────────────────────────────────────────────────────────────────

export async function pathCmd(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const handle = cmd.positionals[0]
  if (!handle) throw new PmError('E_USAGE', 'path requires a handle')
  const all = await ctx.store.discoverProjects()
  const located = resolveHandle(all, handle)
  const crumbs =
    located.kind === 'project'
      ? [{ id: located.project.id, title: located.project.title, type: 'project' as const }]
      : [...lineageOf(located.project, located.task), { id: located.task.id, title: located.task.title, type: located.task.type }]
  return {
    data: { path: crumbs },
    view: { format: 'plain', text: crumbs.map((c) => c.title).join(' › ') }
  }
}

// ─── show ─────────────────────────────────────────────────────────────────────

export async function show(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const handle = cmd.positionals[0]
  if (!handle) throw new PmError('E_USAGE', 'show requires a handle')
  const all = await ctx.store.discoverProjects()
  const located = resolveHandle(all, handle)
  const withBody = flagBool(cmd.flags, 'with-body') || true // show fetches the body by default
  const fields = flagList(cmd.flags, 'fields')

  let entity: Record<string, unknown>
  let body = ''
  let titleLine = ''
  if (located.kind === 'project') {
    if (withBody) await ctx.store.loadProjectBody(located.project)
    const p = located.project
    entity = { id: p.id, title: p.title, filePath: p.filePath, path: p.path ?? '', icon: p.icon, color: p.color, description: p.description }
    body = p.description ?? ''
    titleLine = `[${p.id}] ${p.title}  (project)`
  } else {
    if (withBody) await ctx.store.loadTaskBody(located.task)
    const t = located.task
    const statuses = statusesOf(ctx, located.project)
    entity = { ...t, parentId: located.parentId }
    entity.subtasks = undefined
    body = t.description ?? ''
    titleLine = `${statusGlyph(t.status, statuses)} [${t.id}] ${t.title}  (${t.type})`
  }
  if (fields.length) {
    const trimmed: Record<string, unknown> = {}
    for (const key of fields) if (key in entity) trimmed[key] = entity[key]
    entity = trimmed
  }
  // Plain rendering: a title line, key fields, then the body.
  const lines: string[] = [titleLine]
  const show = (k: string, v: unknown): void => {
    if (fields.length && !fields.includes(k)) return // --fields trims the pretty output too
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return
    lines.push(`  ${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
  }
  if (located.kind === 'task') {
    const t = located.task
    show('status', t.status)
    show('priority', t.priority)
    show('due', t.due)
    show('start', t.start)
    show('assignees', t.assignees)
    show('tags', t.tags)
    show('dependencies', t.dependencies)
  }
  // --fields trims the body too: only show it when unfiltered or explicitly asked.
  if (body.trim() && (!fields.length || fields.includes('description'))) lines.push('', body.trim())
  return { data: entity, view: { format: 'plain', text: lines.join('\n') } }
}

// ─── find / ls ────────────────────────────────────────────────────────────────

function matchDue(taskDue: string | undefined, cmd: ParsedCommand, iso: string): boolean {
  const eq = flagStr(cmd.flags, 'due')
  const before = flagStr(cmd.flags, 'due-before')
  const after = flagStr(cmd.flags, 'due-after')
  const range = flagStr(cmd.flags, 'due-range')
  if (eq) {
    if (eq === 'none') return !taskDue
    if (eq === 'today') return taskDue === iso
    if (eq === 'overdue') return !!taskDue && taskDue < iso
    if (!taskDue || taskDue !== eq) return false
  }
  if (before && !(taskDue && taskDue < before)) return false
  if (after && !(taskDue && taskDue > after)) return false
  if (range) {
    const [a, b] = range.split('..')
    if (!(taskDue && taskDue >= a! && taskDue <= (b ?? a)!)) return false
  }
  return true
}

function matchStart(taskStart: string | undefined, cmd: ParsedCommand): boolean {
  const eq = flagStr(cmd.flags, 'start')
  const before = flagStr(cmd.flags, 'start-before')
  const after = flagStr(cmd.flags, 'start-after')
  if (eq && taskStart !== eq) return false
  if (before && !(taskStart && taskStart < before)) return false
  if (after && !(taskStart && taskStart > after)) return false
  return true
}

/** Duration = whole days from start→due; filter on `>Nd` / `<Nd`. */
function matchDuration(task: Task, spec: string | undefined): boolean {
  if (!spec) return true
  if (!task.start || !task.due) return false
  const a = parsePlainDate(task.start)
  const b = parsePlainDate(task.due)
  if (!a || !b) return false
  const days = a.until(b, { largestUnit: 'day' }).days
  const m = /^([<>])(\d+)d?$/.exec(spec.trim())
  if (!m) return true
  const n = Number(m[2])
  return m[1] === '>' ? days > n : days < n
}

export async function find(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const all = await ctx.store.discoverProjects()
  const iso = ctx.now
  const projectRef = flagStr(cmd.flags, 'project')
  const scope = projectRef ? [resolveProjectRef(all, projectRef)] : all

  const wantStatus = flagList(cmd.flags, 'status')
  const wantPriority = flagList(cmd.flags, 'priority')
  const wantAssignee = flagList(cmd.flags, 'assignee')
  const wantTag = flagList(cmd.flags, 'tag')
  const wantType = flagStr(cmd.flags, 'type')
  const wantMilestone = flagStr(cmd.flags, 'milestone')
  const wantDuration = flagStr(cmd.flags, 'duration')
  const hasNotes = flagBool(cmd.flags, 'has-notes')
  const includeArchived = flagBool(cmd.flags, 'include-archived')
  const text = cmd.positionals[0]?.toLowerCase()

  // Optional milestone scoping: restrict to descendants of a milestone handle.
  let milestoneDescendants: Set<string> | null = null
  if (wantMilestone) {
    const loc = resolveHandle(scope, wantMilestone)
    if (loc.kind === 'task') milestoneDescendants = new Set(flattenTasks(loc.task.subtasks ?? []).map((f) => f.task.id))
  }

  const matched: Located[] = []
  for (const loc of allTasks(scope, includeArchived)) {
    const { project, task } = loc
    if (wantStatus.length && !wantStatus.includes(task.status)) continue
    if (wantPriority.length && !wantPriority.includes(task.priority)) continue
    if (wantType && task.type !== wantType) continue
    if (milestoneDescendants && !milestoneDescendants.has(task.id)) continue
    if (!matchDue(task.due, cmd, iso)) continue
    if (!matchStart(task.start, cmd)) continue
    if (!matchDuration(task, wantDuration)) continue
    if (wantAssignee.length && !wantAssignee.some((a) => task.assignees.includes(a))) continue
    if (wantTag.length && !wantTag.some((t) => task.tags.includes(t))) continue
    if (text && !task.title.toLowerCase().includes(text)) continue
    if (hasNotes) {
      if (!task.filePath) continue
      const file = ctx.vault.getAbstractFileByPath(task.filePath)
      if (!(file instanceof TFile) || !(await ctx.store.hasBodyContent(file))) continue
    }
    matched.push(loc)
  }

  // Sort on any column: id | title | status | due | start | priority | project | type.
  const sortSpec = flagStr(cmd.flags, 'sort')
  if (sortSpec) {
    const [col, dir] = sortSpec.split(':')
    const desc = dir === 'desc'
    const key = (l: Located): string => {
      switch (col) {
        case 'title': return l.task.title
        case 'status': return l.task.status
        case 'due': return l.task.due ?? '~'
        case 'start': return l.task.start ?? '~'
        case 'priority': return l.task.priority
        case 'project': return l.project.title
        case 'type': return l.task.type
        default: return l.task.id
      }
    }
    matched.sort((a, b) => (desc ? key(b).localeCompare(key(a)) : key(a).localeCompare(key(b))))
  }

  const limit = flagNum(cmd.flags, 'limit')
  const chosen = limit !== undefined ? matched.slice(0, limit) : matched

  const columns = ['id', 'status', 'due', 'notes', 'title']
  const rows: ViewRow[] = []
  const data: Record<string, unknown>[] = []
  for (const { project, task } of chosen) {
    const notes = await contentLinesOf(ctx, task)
    const overdue = task.due && task.due < iso ? ` (!${daysOverdue(task.due, iso)}d)` : ''
    rows.push({
      depth: 0,
      title: task.title,
      cols: {
        id: task.id,
        status: task.status,
        due: task.due ?? '',
        notes: notes > 0 ? `✎${notes}` : '·',
        title: `${task.title}${overdue}`
      }
    })
    data.push({ id: task.id, title: task.title, status: task.status, due: task.due, project: project.id, type: task.type })
  }
  return {
    data: { items: pickFields(data, flagList(cmd.flags, 'fields')) },
    view: { format: 'table', columns, rows, footer: `${chosen.length} match${chosen.length === 1 ? '' : 'es'}` }
  }
}

// ─── log ──────────────────────────────────────────────────────────────────────

export async function log(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const since = flagStr(cmd.flags, 'since')
  const all = await ctx.store.discoverProjects()
  const items = allTasks(all)
    .filter(({ task }) => (since ? task.updatedAt >= since : true))
    .sort((a, b) => String(b.task.updatedAt).localeCompare(String(a.task.updatedAt)))
  const limit = flagNum(cmd.flags, 'limit') ?? 30
  const chosen = items.slice(0, limit)
  const columns = ['updated', 'id', 'status', 'title']
  const rows: ViewRow[] = chosen.map(({ task }) => ({
    depth: 0,
    title: task.title,
    cols: { updated: String(task.updatedAt ?? '').slice(0, 16), id: task.id, status: task.status, title: task.title }
  }))
  return {
    data: { items: chosen.map((l) => ({ id: l.task.id, updatedAt: l.task.updatedAt })) },
    view: { format: 'table', columns, rows, footer: `${chosen.length} recently changed` }
  }
}

// ─── explain ────────────────────────────────────────────────────────────────

export async function explain(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const handle = cmd.positionals[0]
  if (!handle) throw new PmError('E_USAGE', 'explain requires a handle')
  const all = await ctx.store.discoverProjects()
  const located = resolveHandle(all, handle)
  if (located.kind !== 'task') throw new PmError('E_NOT_FOUND', 'explain requires a task handle')
  const { project, task } = located
  const statuses = statusesOf(ctx, project)
  const crumbs = [...lineageOf(project, task), { id: task.id, title: task.title, type: task.type }]
  const unmet = unmetDeps(project, task, statuses)
  const dependents = directDependents(project, task.id)
  const blockedNames = unmet.map((id) => findTaskById(project, id)?.title ?? id)
  const lines: string[] = []
  lines.push(crumbs.map((c) => c.title).join(' › '))
  lines.push('')
  const state = isComplete(task, statuses) ? 'complete' : unmet.length ? 'blocked' : 'actionable'
  lines.push(
    `[${task.id}] "${task.title}" is ${state}${task.due ? `, due ${task.due}` : ''}. ` +
      (unmet.length
        ? `It is waiting on ${unmet.length} unmet dependenc${unmet.length === 1 ? 'y' : 'ies'}: ${blockedNames.join(', ')}.`
        : 'Nothing blocks it.') +
      (dependents.length ? ` It blocks ${dependents.length} downstream task${dependents.length === 1 ? '' : 's'}.` : '')
  )
  return {
    data: {
      id: task.id,
      lineage: crumbs,
      blocked_by: unmet,
      blocks: dependents.map((t) => t.id),
      status: task.status
    },
    view: { format: 'plain', text: lines.join('\n') }
  }
}

// ─── palette ──────────────────────────────────────────────────────────────────

export async function palette(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const ref = cmd.positionals[0] ?? flagStr(cmd.flags, 'project')
  let statuses = ctx.settings.statuses
  let priorities = ctx.settings.priorities
  let scope = 'global'
  if (ref) {
    const all = await ctx.store.discoverProjects()
    const project = resolveProjectRef(all, ref)
    const cfg = ctx.store.configFor(project)
    statuses = cfg.statuses
    priorities = cfg.priorities
    scope = project.title
  }
  const lines = [
    `palette (${scope})`,
    `  statuses:   ${statuses.map((s) => s.id + (s.complete ? '*' : '')).join('  ')}`,
    `  priorities: ${priorities.map((p) => p.id).join('  ')}`,
    `  (* = terminal/complete)`
  ]
  return {
    data: { scope, statuses, priorities },
    view: { format: 'plain', text: lines.join('\n') }
  }
}

// ─── schema ───────────────────────────────────────────────────────────────────

const TASK_SCHEMA = {
  $id: 'pm:task',
  type: 'object',
  required: ['id', 'title', 'type', 'status', 'priority'],
  properties: {
    id: { type: 'string', description: 'stable, minted by makeId()' },
    title: { type: 'string' },
    type: { enum: ['task', 'milestone', 'subtask'] },
    status: { type: 'string', 'x-palette': 'status' },
    priority: { type: 'string', 'x-palette': 'priority' },
    start: { type: 'string', pattern: '^(\\d{4}-\\d{2}-\\d{2})?$' },
    due: { type: 'string', pattern: '^(\\d{4}-\\d{2}-\\d{2})?$' },
    progress: { type: 'integer', minimum: 0, maximum: 100 },
    completed: { type: 'string' },
    assignees: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } },
    dependencies: { type: 'array', items: { type: 'string' } },
    subtaskIds: { type: 'array', items: { type: 'string' } },
    timeEstimate: { type: 'number' },
    customFields: { type: 'object' }
  }
}

const PROJECT_SCHEMA = {
  $id: 'pm:project',
  type: 'object',
  required: ['id', 'title'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    path: { type: 'string' },
    icon: { type: 'string' },
    color: { type: 'string' }
  }
}

const APPLY_SCHEMA = {
  $id: 'pm:apply',
  type: 'object',
  required: ['project'],
  properties: {
    project: { type: 'object', required: ['title'], properties: { key: { type: 'string' }, title: { type: 'string' }, dir: { type: 'string' } } },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title'],
        properties: {
          key: { type: 'string' },
          title: { type: 'string' },
          type: { enum: ['task', 'milestone', 'subtask'] },
          status: { type: 'string' },
          due: { type: 'string' },
          depends_on: { type: 'array', items: { type: 'string' } },
          subtasks: { type: 'array', items: { $ref: '#/properties/tasks/items' } }
        }
      }
    }
  }
}

const BATCH_SCHEMA = {
  $id: 'pm:batch',
  type: 'object',
  description: 'one op per NDJSON line',
  required: ['op'],
  properties: {
    op: { enum: ['new_task', 'new_subtask', 'new_milestone', 'set', 'depend', 'undepend', 'mv', 'archive', 'rm', 'note'] },
    project: { type: 'string' },
    handle: { type: 'string' },
    key: { type: 'string' },
    title: { type: 'string' },
    patch: { type: 'object' },
    on: { type: 'array', items: { type: 'string' } },
    under: { type: 'string' }
  }
}

const SCHEMAS: Record<string, unknown> = { task: TASK_SCHEMA, project: PROJECT_SCHEMA, apply: APPLY_SCHEMA, batch: BATCH_SCHEMA }

export function schema(_ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const entity = cmd.positionals[0]
  const doc = entity && entity in SCHEMAS ? { [entity]: SCHEMAS[entity] } : SCHEMAS
  return Promise.resolve({
    data: { schema: entity && entity in SCHEMAS ? SCHEMAS[entity] : SCHEMAS },
    view: { format: 'plain', text: JSON.stringify(doc, null, 2) }
  })
}

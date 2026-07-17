// The rendering layer — the DEFAULT, agent-legible output of every `pm` command.
// Handlers return a normalized `ViewSpec` (alongside their JSON `data`); this
// module projects it to the pretty printout (default), the `--porcelain` TSV, or
// the `--ndjson` stream. The JSON envelope is opt-in via `--json`.
//
// ── FROZEN GRAMMAR (do not "improve" without re-freezing) ────────────────────
// Two audiences, two contracts, one view-model:
//   • PRETTY (default) is the SCAN format — human eyeball + agent + `grep`. It is
//     SPACE-DELIMITED, NOT column-aligned. A parser keys on TOKENS at deterministic
//     positions: the glyph at the leading position (after `'   '×depth` indent),
//     the bracketed `[id]` anchor, and the sigils `✎N` `▸N` `!Nd` `⊘ blocked by [id]`.
//     It must NEVER be treated as fixed-width columns.
//   • --porcelain is the STRICT machine contract — TSV, NO header line, a FIXED
//     documented column order (PORCELAIN_COLUMNS), one record per line, FAITHFUL
//     (carries every load-bearing field; never lossy). `--ndjson` streams the
//     identical key set. `--json` is the structured alternative.
// Vocabulary (glyphs, `✎N`, `▸N`, `!Nd`, `[id]`, lineage-by-indent, one `⚠`) is
// normative from the engineer's mockups; exact bytes (column order, legend
// wording, footer grammar, whitespace) are frozen HERE. `--fields` trims json/
// pretty only — it NEVER reshapes porcelain columns. Blank-line count is never a
// parse key (whitespace is constructed exactly, not repaired).

import { TFile } from 'obsidian'
import type { Project, StatusConfig, Task } from '../../src/types'
import { findParentId, findTaskById, flattenTasks } from '../../src/store'
import type { PmContext } from './PmContext'

// ─── glyphs & legend (frozen) ────────────────────────────────────────────────

export const GLYPH = { todo: '○', doing: '◐', done: '●', blocked: '⊘' } as const

/** Leading status glyph. Pure function of the status id + palette — the blocked
 *  CONDITION (unmet deps) is a trailing `⊘ blocked by …` annotation, not this. */
export function statusGlyph(status: string, statuses: StatusConfig[]): string {
  const cfg = statuses.find((s) => s.id === status)
  if (cfg?.complete) return GLYPH.done
  if (status === 'blocked') return GLYPH.blocked
  const firstOpen = statuses.find((s) => !s.complete)?.id
  if (status === firstOpen) return GLYPH.todo
  return GLYPH.doing
}

export interface LegendEntry {
  symbol: string
  meaning: string
}

/** The frozen legend vocabulary. Views compose from these; wording is byte-exact. */
export const LEGEND: Record<string, LegendEntry> = {
  todo: { symbol: '○', meaning: 'todo' },
  doing: { symbol: '◐', meaning: 'doing' },
  done: { symbol: '●', meaning: 'done' },
  blocked: { symbol: '⊘', meaning: 'blocked' },
  notes: { symbol: '✎N', meaning: 'N lines of note body' },
  children: { symbol: '▸N', meaning: 'N children' },
  overdue: { symbol: '!Nd', meaning: 'overdue by N days' }
}

/** The four status glyphs, in canonical order. */
export const statusLegend = (): LegendEntry[] => [LEGEND.todo!, LEGEND.doing!, LEGEND.done!, LEGEND.blocked!]

/** Back-compat single-string legend (used only where a `data.legend` echo is wanted). */
export const STATUS_LEGEND = '○ = todo · ◐ = doing · ● = done · ⊘ = blocked'
export const STATUS_LEGEND_ENTRIES: LegendEntry[] = statusLegend()

function legendLine(entries: LegendEntry[]): string {
  return 'legend:  ' + entries.map((e) => `${e.symbol} = ${e.meaning}`).join('   ')
}

// ─── the view model ─────────────────────────────────────────────────────────

export type Rel = 'sub' | 'needs' | 'blocks'

export interface ViewRow {
  id?: string
  depth: number
  /** Lineage context header (project / ancestor): title only, no glyph. */
  isHeader?: boolean
  glyph?: string
  /** raw status id (for porcelain/ndjson faithfulness). */
  status?: string
  type?: string
  title: string
  due?: string
  /** → `✎N`; 0/undefined renders nothing. */
  contentLines?: number
  /** → `▸N`. */
  childCount?: number
  /** → `!Nd`. */
  overdueDays?: number
  /** → e.g. `3/8 done`. */
  progress?: string
  /** dependency-blocked-by ids → `⊘ blocked by [id]` (pretty) + `blocked_by` col. */
  blockedBy?: string[]
  assignees?: string[]
  priority?: string
  /** section identity for graph views, preserved into machine modes. */
  rel?: Rel
  /** table-mode column values, keyed by column name. */
  cols?: Record<string, string>
}

export interface ViewSection {
  label: string
  rel?: Rel
  rows: ViewRow[]
}

export type ViewFormat = 'lineage' | 'table' | 'graph' | 'plain'

export interface ViewSpec {
  format: ViewFormat
  legend?: LegendEntry[]
  /** show assignees/priority/tags in pretty (the `--rich` toggle). */
  rich?: boolean
  /** the single ⚠ pointer, rendered at the very top when present. */
  warning?: string
  /** context line under the legend, e.g. `today = 2026-07-16`. */
  header?: string
  /** table column order (table format). */
  columns?: string[]
  rows?: ViewRow[]
  /** grouped rows (graph/deps: needs / blocks). */
  sections?: ViewSection[]
  footer?: string
  /** plain format: pre-rendered text (schema/palette/show). */
  text?: string
}

// ─── pretty renderer ────────────────────────────────────────────────────────

/** Trailing sigil tokens for a row, built via ONE helper (no per-handler dialects). */
function trailingTokens(r: ViewRow, rich: boolean): string[] {
  const t: string[] = []
  if (r.due) t.push(`due ${r.due}`)
  if (r.overdueDays !== undefined && r.overdueDays > 0) t.push(`!${r.overdueDays}d`)
  if (r.contentLines !== undefined && r.contentLines > 0) t.push(`✎${r.contentLines}`)
  if (r.childCount !== undefined && r.childCount > 0) t.push(`▸${r.childCount}`)
  if (r.progress) t.push(r.progress)
  if (r.blockedBy?.length) t.push(`⊘ blocked by ${r.blockedBy.map((i) => `[${i}]`).join(', ')}`)
  if (rich) {
    if (r.priority && r.priority !== 'medium') t.push(`!${r.priority}`)
    for (const a of r.assignees ?? []) t.push(`@${a}`)
  }
  return t
}

function itemLine(r: ViewRow, rich: boolean): string {
  const indent = '   '.repeat(r.depth)
  if (r.isHeader) return `${indent}${r.title}`
  const head: string[] = []
  if (r.glyph) head.push(r.glyph)
  if (r.id) head.push(`[${r.id}]`)
  head.push(r.title)
  const tail = trailingTokens(r, rich)
  const left = `${indent}${head.join(' ')}`
  return tail.length ? `${left}   ${tail.join('  ')}` : left
}

export function renderPretty(v: ViewSpec): string {
  if (v.format === 'plain') return v.text ?? ''
  const rich = v.rich ?? false
  const out: string[] = []
  if (v.warning) {
    out.push(v.warning)
    out.push('')
  }
  if (v.legend) out.push(legendLine(v.legend))
  if (v.header) out.push(v.header)
  if (v.legend || v.header) out.push('')
  if (v.format === 'table' && v.columns) {
    out.push(...padCols(v.columns, v.rows ?? []))
  } else if (v.sections) {
    v.sections.forEach((s, i) => {
      if (i > 0) out.push('')
      out.push(`${s.label}:`)
      for (const r of s.rows) out.push(itemLine({ ...r, depth: Math.max(r.depth, 1) }, rich))
    })
  } else {
    for (const r of v.rows ?? []) out.push(itemLine(r, rich))
  }
  if (v.footer) {
    out.push('')
    out.push(v.footer)
  }
  return out.join('\n').trimEnd()
}

function padCols(columns: string[], rows: ViewRow[]): string[] {
  const widths = columns.map((c) => c.length)
  for (const r of rows) {
    columns.forEach((c, i) => {
      const v = r.cols?.[c] ?? ''
      if (v.length > widths[i]!) widths[i] = v.length
    })
  }
  const fmt = (vals: string[]): string => vals.map((v, i) => v.padEnd(widths[i]!)).join('  ').trimEnd()
  const out = [fmt(columns)]
  for (const r of rows) out.push(fmt(columns.map((c) => r.cols?.[c] ?? '')))
  return out
}

// ─── porcelain (TSV, no header, fixed columns, faithful) ─────────────────────

/** The frozen porcelain column order for lineage/graph task records. */
export const PORCELAIN_COLUMNS = [
  'kind',
  'rel',
  'id',
  'depth',
  'status',
  'type',
  'title',
  'due',
  'overdue_days',
  'child_count',
  'progress',
  'content_lines',
  'blocked_by',
  'assignee',
  'priority'
] as const

/** The faithful machine-record for one row (shared by porcelain + ndjson). */
function machineRecord(r: ViewRow): Record<string, string | number> {
  return {
    kind: r.isHeader ? 'header' : 'row',
    rel: r.rel ?? '',
    id: r.id ?? '',
    depth: r.depth,
    status: r.status ?? '',
    type: r.type ?? '',
    title: r.title,
    due: r.due ?? '',
    overdue_days: r.overdueDays ?? '',
    child_count: r.childCount ?? '',
    progress: r.progress ?? '',
    content_lines: r.contentLines ?? 0,
    blocked_by: (r.blockedBy ?? []).join(','),
    assignee: (r.assignees ?? []).join(','),
    priority: r.priority ?? ''
  }
}

function flatRows(v: ViewSpec): ViewRow[] {
  return v.sections ? v.sections.flatMap((s) => s.rows.map((r) => ({ ...r, rel: r.rel ?? s.rel }))) : (v.rows ?? [])
}

/** Stable TSV for `cut`/`awk`. No header line (git-porcelain discipline). */
export function renderPorcelain(v: ViewSpec): string {
  if (v.format === 'plain') return v.text ?? ''
  if (v.format === 'table' && v.columns) {
    return (v.rows ?? []).map((r) => v.columns!.map((c) => r.cols?.[c] ?? '').join('\t')).join('\n')
  }
  return flatRows(v)
    .map((r) => {
      const rec = machineRecord(r)
      return PORCELAIN_COLUMNS.map((c) => String(rec[c] ?? '')).join('\t')
    })
    .join('\n')
}

// ─── ndjson (one object per line, faithful, identical keys) ──────────────────

export function renderNdjson(v: ViewSpec): string {
  if (v.format === 'plain') return JSON.stringify({ kind: 'text', text: v.text ?? '' })
  const rows = v.format === 'table' ? (v.rows ?? []) : flatRows(v)
  const lines: string[] = [JSON.stringify({ kind: 'header', format: v.format, count: rows.length })]
  for (const r of rows) {
    lines.push(JSON.stringify(v.format === 'table' ? { kind: 'row', ...r.cols } : machineRecord(r)))
  }
  return lines.join('\n')
}

// ─── flat tree-node array (for tree/JSON payloads) ──────────────────────────

export interface TreeNode {
  id: string
  depth: number
  parentId: string | null
  status: string
  title: string
  type: string
  content_lines: number
  has_content: boolean
}

/** Count the real (INT-021-detected) body lines of a task's note, 0 if none. */
export async function contentLinesOf(ctx: PmContext, task: Task): Promise<number> {
  if (!task.filePath) return 0
  const file = ctx.vault.getAbstractFileByPath(task.filePath)
  if (!(file instanceof TFile)) return 0
  return ctx.store.bodyContentLines(file)
}

/** Count the real body lines of a project's note, 0 if none. */
export async function projectContentLinesOf(ctx: PmContext, project: Project): Promise<number> {
  const file = ctx.vault.getAbstractFileByPath(project.filePath)
  if (!(file instanceof TFile)) return 0
  return ctx.store.bodyContentLines(file)
}

/**
 * Build the flat pre-order node array for a subtree rooted at `root` (or the
 * whole project when `root` is null). Each node carries the INT-021 `content_lines`.
 */
export async function buildTreeNodes(
  ctx: PmContext,
  project: Project,
  root: Task | null,
  opts: { depth?: number; includeRoot?: boolean; includeArchived?: boolean } = {}
): Promise<TreeNode[]> {
  const maxDepth = opts.depth ?? Infinity
  const flat = root
    ? [
        ...(opts.includeRoot === false
          ? []
          : [{ task: root, depth: 0, parentId: findParentId(project, root.id), visible: true }]),
        ...flattenTasks(root.subtasks, opts.includeRoot === false ? 0 : 1, root.id)
      ]
    : flattenTasks(project.tasks)

  const nodes: TreeNode[] = []
  for (const f of flat) {
    if (f.depth > maxDepth) continue
    if (f.task.archived && !opts.includeArchived) continue
    const lines = await contentLinesOf(ctx, f.task)
    nodes.push({
      id: f.task.id,
      depth: f.depth,
      parentId: f.parentId,
      status: f.task.status,
      title: f.task.title,
      type: f.task.type,
      content_lines: lines,
      has_content: lines > 0
    })
  }
  return nodes
}

// ─── lineage ────────────────────────────────────────────────────────────────

export interface LineageEntry {
  id: string
  title: string
  type: 'project' | 'task' | 'milestone' | 'subtask'
}

/**
 * The ancestry of a task, project-root first down to (and excluding) the task
 * itself: `[project, …ancestors]`. Always at least the project (length ≥ 1).
 */
export function lineageOf(project: Project, task: Task): LineageEntry[] {
  const ancestors: LineageEntry[] = []
  let parentId = findParentId(project, task.id)
  while (parentId) {
    const parent = findTaskById(project, parentId)
    if (!parent) break
    ancestors.unshift({ id: parent.id, title: parent.title, type: parent.type })
    parentId = findParentId(project, parent.id)
  }
  return [{ id: project.id, title: project.title, type: 'project' }, ...ancestors]
}

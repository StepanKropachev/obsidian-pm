// Mutation verbs: the general `set` patch, its `status`/`assign`/`due`/`priority`
// convenience wrappers, `note` (body edit), `rename` (bidirectional), `mv`
// (reparent / project folder move), `reorder` (resequence siblings), `shift`
// (relative date move + cascade), `dup` (clone), `rm` (trash), `reconcile`
// (heal hand-authored task files), and `archive`/`unarchive`. Every write
// delegates to a tested store mutator; the CLI only coerces inputs, shapes the
// envelope, and (default-on) runs one post-mutation schedule cascade.

import { TFile } from 'obsidian'
import type { Project, Task } from '../../../src/types'
import { parsePlainDate } from '../../../src/dates'
import { computeSchedule, findTaskById, flattenTasks } from '../../../src/store'
import type { PmContext } from '../PmContext'
import { resolveHandle, resolveProjectRef, type Located } from '../handles'
import { PmError, type HandlerOutput } from '../envelope'
import type { ParsedCommand } from '../args'
import { flagBool, flagStr } from '../args'
import { coercePatch, parseAssignments, parseDelta } from '../coerce'
import type { ViewSpec } from '../render'
import { cascadeAfterMutation, patchTriggersSchedule, previewCascade } from '../schedule'

/** Unique-preserving concat. */
function uniq(...lists: string[][]): string[] {
  return [...new Set(lists.flat())]
}

/** Apply a shallow field patch onto a cloned task tree (for dry-run preview). */
function cloneWithPatch(project: Project, taskId: string, patch: Partial<Task>): Project {
  const clone = structuredClone(project) as Project
  const stack: Task[] = [...clone.tasks]
  while (stack.length) {
    const t = stack.pop()!
    if (t.id === taskId) {
      Object.assign(t, patch)
      break
    }
    stack.push(...t.subtasks)
  }
  return clone
}

// ─── set (general patch) ────────────────────────────────────────────────────

export async function set(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const handle = cmd.positionals[0]
  if (!handle) throw new PmError('E_USAGE', 'set requires a handle')
  const raw = parseAssignments(cmd.positionals.slice(1))
  const jsonPatch = flagStr(cmd.flags, 'patch')
  if (Object.keys(raw).length === 0 && jsonPatch === undefined) {
    throw new PmError('E_USAGE', 'set requires at least one field=value or --patch <json>')
  }

  const all = await ctx.store.discoverProjects()
  const located = resolveHandle(all, handle)
  const dryRun = flagBool(cmd.flags, 'dry-run')
  // Both --no-cascade and --no-schedule suppress the post-mutation scheduler pass.
  const noCascade = flagBool(cmd.flags, 'no-cascade') || flagBool(cmd.flags, 'no-schedule')

  const parsed = parseJsonPatch(jsonPatch)

  if (located.kind === 'project') {
    // Fold a JSON patch's entries into the raw string map (project fields are
    // saved verbatim; renames/moves are handled by `setProject`).
    if (parsed) for (const [k, v] of Object.entries(parsed)) raw[k] = String(v)
    return setProject(ctx, located.project, raw, dryRun)
  }

  const patch = coercePatch(raw)
  if (parsed) Object.assign(patch, parsed)
  return applyTaskPatch(ctx, located.project, located.task.id, patch, { dryRun, noCascade })
}

/** Parse the optional `--patch '<json>'` object, or undefined when absent. */
function parseJsonPatch(json: string | undefined): Record<string, unknown> | undefined {
  if (json === undefined || json === '') return undefined
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    throw new PmError('E_USAGE', '--patch must be a valid JSON object')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PmError('E_USAGE', '--patch must be a JSON object')
  }
  return value as Record<string, unknown>
}

/** Patch a project: `title` renames it, `dir` moves it, others save in place. */
async function setProject(
  ctx: PmContext,
  project: Project,
  raw: Record<string, string>,
  dryRun: boolean
): Promise<HandlerOutput> {
  if (dryRun) return { data: { id: project.id, patch: raw }, changed_ids: [project.id] }
  if (raw.dir !== undefined) await ctx.store.moveProject(project, raw.dir)
  if (raw.title !== undefined) await ctx.store.renameProject(project, raw.title)
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'dir' || k === 'title') continue
    ;(project as unknown as Record<string, unknown>)[k] = v
  }
  if (Object.keys(raw).some((k) => k !== 'dir' && k !== 'title')) await ctx.store.saveProject(project)
  return { data: { id: project.id }, changed_ids: [project.id] }
}

/**
 * The shared task-mutation path: apply the patch through `updateTask`, then run
 * one schedule cascade (unless suppressed) and report the moved dependents.
 */
async function applyTaskPatch(
  ctx: PmContext,
  project: Project,
  taskId: string,
  patch: Partial<Task>,
  opts: { dryRun: boolean; noCascade: boolean }
): Promise<HandlerOutput> {
  const willSchedule = !opts.noCascade && patchTriggersSchedule(patch as Record<string, unknown>)

  if (opts.dryRun) {
    let scheduled: string[] = []
    if (willSchedule) {
      const preview = cloneWithPatch(project, taskId, patch)
      scheduled = previewCascade(preview, ctx.store.configFor(project).statuses, taskId)
    }
    const warnings = scheduled.length
      ? [{ code: 'W_CASCADE', message: `${scheduled.length} dependent(s) would reschedule`, ids: scheduled }]
      : undefined
    return { data: { id: taskId, patch, scheduled }, changed_ids: uniq([taskId], scheduled), warnings }
  }

  await ctx.store.updateTask(project, taskId, patch)
  const scheduled = willSchedule ? await cascadeAfterMutation(ctx, project, taskId) : []
  const warnings = scheduled.length
    ? [{ code: 'W_CASCADE', message: `${scheduled.length} dependent(s) rescheduled`, ids: scheduled }]
    : undefined
  return { data: { id: taskId, scheduled }, changed_ids: uniq([taskId], scheduled), warnings }
}

// ─── status / assign / due / priority (convenience wrappers on set) ─────────

function convenience(field: string): (ctx: PmContext, cmd: ParsedCommand) => Promise<HandlerOutput> {
  return async (ctx, cmd) => {
    const handle = cmd.positionals[0]
    if (!handle) throw new PmError('E_USAGE', `${field} requires a handle`)
    const value = cmd.positionals.slice(1).join(',')
    const all = await ctx.store.discoverProjects()
    const located = resolveHandle(all, handle)
    if (located.kind !== 'task') throw new PmError('E_NOT_FOUND', `${field} requires a task handle`)
    const patch = coercePatch({ [field]: value })
    return applyTaskPatch(ctx, located.project, located.task.id, patch, {
      dryRun: flagBool(cmd.flags, 'dry-run'),
      noCascade: flagBool(cmd.flags, 'no-cascade') || flagBool(cmd.flags, 'no-schedule')
    })
  }
}

export const status = convenience('status')
export const priority = convenience('priority')
export const due = convenience('due')

/**
 * `assign <handle> @a @b` sets the assignee list. `--add` merges the named
 * people onto the existing list, `--remove` drops them, and the default
 * replaces the whole list (comma/space separated; a leading `@` is optional).
 */
export async function assign(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const handle = cmd.positionals[0]
  if (!handle) throw new PmError('E_USAGE', 'assign requires a handle')
  const people = cmd.positionals.slice(1).map((p) => p.replace(/^@/, ''))
  const all = await ctx.store.discoverProjects()
  const located = resolveHandle(all, handle)
  if (located.kind !== 'task') throw new PmError('E_NOT_FOUND', 'assign requires a task handle')

  const current = located.task.assignees ?? []
  let assignees: string[]
  if (flagBool(cmd.flags, 'add')) assignees = uniq(current, people)
  else if (flagBool(cmd.flags, 'remove')) assignees = current.filter((a) => !people.includes(a))
  else assignees = people

  return applyTaskPatch(ctx, located.project, located.task.id, { assignees }, {
    dryRun: flagBool(cmd.flags, 'dry-run'),
    noCascade: flagBool(cmd.flags, 'no-cascade')
  })
}

// ─── note (body edit) ───────────────────────────────────────────────────────

/** Fold the current body with the requested edit; undefined if no edit flag. */
function computeBody(current: string, cmd: ParsedCommand): string | undefined {
  const setText = flagStr(cmd.flags, 'set')
  const appendText = flagStr(cmd.flags, 'append')
  const prependText = flagStr(cmd.flags, 'prepend')
  if (setText !== undefined) return setText
  if (appendText !== undefined) return current ? `${current}\n\n${appendText}` : appendText
  if (prependText !== undefined) return current ? `${prependText}\n\n${current}` : prependText
  return undefined
}

export async function note(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const handle = cmd.positionals[0]
  if (!handle) throw new PmError('E_USAGE', 'note requires a handle')
  const all = await ctx.store.discoverProjects()
  const located = resolveHandle(all, handle)
  const dryRun = flagBool(cmd.flags, 'dry-run')

  // Project body: hydrate → edit → saveProject (writes the note body).
  if (located.kind === 'project') {
    const { project } = located
    await ctx.store.loadProjectBody(project)
    const next = computeBody(project.description ?? '', cmd)
    if (next === undefined) throw new PmError('E_USAGE', 'note requires one of --set, --append, --prepend')
    if (dryRun) return { data: { id: project.id, description: next }, changed_ids: [project.id] }
    project.description = next
    await ctx.store.saveProject(project)
    return { data: { id: project.id }, changed_ids: [project.id] }
  }

  const { project, task } = located
  await ctx.store.loadTaskBody(task)
  const next = computeBody(task.description ?? '', cmd)
  if (next === undefined) throw new PmError('E_USAGE', 'note requires one of --set, --append, --prepend')
  if (dryRun) return { data: { id: task.id, description: next }, changed_ids: [task.id] }
  await ctx.store.updateTask(project, task.id, { description: next })
  return { data: { id: task.id }, changed_ids: [task.id] }
}

// ─── rename (bidirectional) ─────────────────────────────────────────────────

export async function rename(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const handle = cmd.positionals[0]
  if (!handle) throw new PmError('E_USAGE', 'rename requires a handle')
  const title = flagStr(cmd.flags, 'title') ?? cmd.positionals.slice(1).join(' ')
  if (!title) throw new PmError('E_USAGE', 'rename requires a new title')
  const all = await ctx.store.discoverProjects()
  const located = resolveHandle(all, handle)
  const dryRun = flagBool(cmd.flags, 'dry-run')

  if (located.kind === 'project') {
    if (!dryRun) await ctx.store.renameProject(located.project, title)
    return { data: { id: located.project.id, title }, changed_ids: [located.project.id] }
  }
  if (!dryRun) await ctx.store.updateTask(located.project, located.task.id, { title })
  return { data: { id: located.task.id, title }, changed_ids: [located.task.id] }
}

// ─── mv (reparent) / mv project (folder move) ───────────────────────────────

export async function mv(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const dryRun = flagBool(cmd.flags, 'dry-run')

  // `mv project <handle> --dir <path>` relocates a project's whole folder.
  if (cmd.positionals[0] === 'project') {
    const handle = cmd.positionals[1]
    if (!handle) throw new PmError('E_USAGE', 'mv project requires a project handle')
    const dir = flagStr(cmd.flags, 'dir')
    if (dir === undefined) throw new PmError('E_USAGE', 'mv project requires --dir <path>')
    const all = await ctx.store.discoverProjects()
    const located = resolveHandle(all, handle)
    if (located.kind !== 'project') throw new PmError('E_NOT_FOUND', 'mv project requires a project handle')
    if (!dryRun) await ctx.store.moveProject(located.project, dir)
    return { data: { id: located.project.id, dir }, changed_ids: [located.project.id] }
  }

  // `mv <handle> --parent <handle|root>` reparents a task.
  const handle = cmd.positionals[0]
  if (!handle) throw new PmError('E_USAGE', 'mv requires a handle')
  const parentRef = flagStr(cmd.flags, 'parent')
  if (parentRef === undefined) throw new PmError('E_USAGE', 'mv requires --parent <handle|root>')
  const all = await ctx.store.discoverProjects()
  const located = resolveHandle(all, handle)
  if (located.kind !== 'task') throw new PmError('E_NOT_FOUND', 'mv requires a task handle')

  let newParentId: string | null = null
  if (parentRef !== 'root') {
    const parent = resolveTaskInProject(located, parentRef)
    newParentId = parent.id
  }
  if (!dryRun) await ctx.store.moveTask(located.project, located.task.id, newParentId)
  return { data: { id: located.task.id, parentId: newParentId }, changed_ids: [located.task.id] }
}

/** Resolve a task handle within the SAME project as `located`. */
function resolveTaskInProject(located: Located & { kind: 'task' }, ref: string): Task {
  const inner = resolveHandle([located.project], ref)
  if (inner.kind !== 'task') throw new PmError('E_NOT_FOUND', `handle "${ref}" is not a task`)
  return inner.task
}

// ─── reorder (resequence siblings) ──────────────────────────────────────────

export async function reorder(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const handle = cmd.positionals[0]
  if (!handle) throw new PmError('E_USAGE', 'reorder requires a handle')
  const before = flagStr(cmd.flags, 'before')
  const after = flagStr(cmd.flags, 'after')
  if (before === undefined && after === undefined) {
    throw new PmError('E_USAGE', 'reorder requires --before <sibling> or --after <sibling>')
  }
  const position: 'before' | 'after' = before !== undefined ? 'before' : 'after'
  const siblingRef = (before ?? after)!

  const all = await ctx.store.discoverProjects()
  const located = resolveHandle(all, handle)
  if (located.kind !== 'task') throw new PmError('E_NOT_FOUND', 'reorder requires a task handle')
  const sibling = resolveTaskInProject(located, siblingRef)

  if (!flagBool(cmd.flags, 'dry-run')) {
    await ctx.store.reorderTask(located.project, located.task.id, sibling.id, position)
  }
  return { data: { id: located.task.id, target: sibling.id, position }, changed_ids: [located.task.id] }
}

// ─── dup (clone a task / subtree) ───────────────────────────────────────────

export async function dup(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const handle = cmd.positionals[0]
  if (!handle) throw new PmError('E_USAGE', 'dup requires a handle')
  const all = await ctx.store.discoverProjects()
  const located = resolveHandle(all, handle)
  if (located.kind !== 'task') throw new PmError('E_NOT_FOUND', 'dup requires a task handle')
  const withSubtasks = flagBool(cmd.flags, 'with-subtasks')

  if (flagBool(cmd.flags, 'dry-run')) {
    return { data: { source: located.task.id, withSubtasks }, changed_ids: [located.task.id] }
  }
  const copy = await ctx.store.duplicateTask(located.project, located.task.id, withSubtasks)
  if (!copy) throw new PmError('E_NOT_FOUND', `Could not duplicate task "${handle}"`)
  return { data: { id: copy.id, source: located.task.id, withSubtasks }, changed_ids: [copy.id] }
}

// ─── rm (trash — reversible, never hard-delete) ─────────────────────────────

export async function rm(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const handle = cmd.positionals[0]
  if (!handle) throw new PmError('E_USAGE', 'rm requires a handle')
  const all = await ctx.store.discoverProjects()
  const located = resolveHandle(all, handle)
  const dryRun = flagBool(cmd.flags, 'dry-run')

  // `--project` is a value-flag elsewhere (create), so detect it by PRESENCE
  // rather than a boolean: `rm <handle> --project` leaves it as a trailing key.
  if (cmd.flags.project !== undefined) {
    if (located.kind !== 'project') throw new PmError('E_NOT_FOUND', 'rm --project requires a project handle')
    if (!dryRun) await ctx.store.deleteProject(located.project)
    return { data: { id: located.project.id, deleted: true }, changed_ids: [located.project.id] }
  }

  if (located.kind === 'project') {
    throw new PmError('E_USAGE', 'refusing to delete a project without --project')
  }
  if (!dryRun) await ctx.store.deleteTask(located.project, located.task.id)
  return { data: { id: located.task.id, deleted: true }, changed_ids: [located.task.id] }
}

// ─── reconcile (heal hand-authored pm-task files) ───────────────────────────

/**
 * Backfill/heal hand-authored `pm-task` markdown files. Loading a project
 * already mints ids and self-heals wiring; `reconcile` routes any file still
 * unwired (not represented in the loaded tree) through `ingestExternalTask`,
 * which backfills its full required frontmatter + defaults and persists the
 * project's ordering. Idempotent — a re-run over a healthy vault is a no-op.
 */
export async function reconcile(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const target = cmd.positionals[0]
  const dryRun = flagBool(cmd.flags, 'dry-run')
  const all = await ctx.store.discoverProjects()
  const projects = target ? [resolveProjectRef(all, target)] : all

  const ingested: string[] = []
  const candidates: string[] = []
  for (const project of projects) {
    const taskFolder = project.filePath.replace(/\.md$/, '_tasks')
    const prefix = `${taskFolder}/`
    const wired = new Set(
      flattenTasks(project.tasks)
        .map((f) => f.task.filePath)
        .filter((p): p is string => Boolean(p))
    )
    const files = ctx.vault.getMarkdownFiles().filter((f: TFile) => f.path.startsWith(prefix))
    for (const file of files) {
      if (wired.has(file.path)) continue
      candidates.push(file.path)
      if (dryRun) continue
      const task = await ctx.store.ingestExternalTask(project, file)
      if (task) ingested.push(task.id)
    }
  }

  return {
    data: dryRun ? { candidates } : { ingested },
    changed_ids: dryRun ? [] : ingested
  }
}

// ─── shift (relative date move + cascade) ───────────────────────────────────

/** Shift an ISO date by `delta` whole days; empty stays empty. */
function shiftIso(iso: string, delta: number): string {
  if (!iso) return iso
  return parsePlainDate(iso)?.add({ days: delta }).toString() ?? iso
}

/** The single date a row displays: due when present, else start. */
function primaryDate(task: { start: string; due: string }): string {
  return task.due || task.start
}

interface ShiftMove {
  id: string
  kind: 'self' | 'subtask' | 'depends-on'
  label: string
  old: string
  new: string
}

export async function shift(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const handle = cmd.positionals[0]
  if (!handle) throw new PmError('E_USAGE', 'shift requires a handle')
  const offset = cmd.positionals[1]
  const delta = offset ? parseDelta(offset) : null
  if (delta === null) throw new PmError('E_USAGE', 'shift requires an offset like +7d, -3d, +2w, or +1m')

  const all = await ctx.store.discoverProjects()
  const located = resolveHandle(all, handle)
  if (located.kind !== 'task') throw new PmError('E_NOT_FOUND', 'shift requires a task handle')
  const { project, task } = located
  const noCascade = flagBool(cmd.flags, 'no-cascade')
  const noSchedule = flagBool(cmd.flags, 'no-schedule')
  // --no-cascade → move ONLY the item (no subtree, no downstream). --no-schedule
  // → move the item + subtree but skip the downstream scheduler pass.
  const scheduleDownstream = !(noCascade || noSchedule)
  const statuses = ctx.store.configFor(project).statuses

  if (flagBool(cmd.flags, 'dry-run')) {
    const moves = previewShift(project, task, delta, statuses, noCascade, scheduleDownstream)
    return {
      data: { id: task.id, delta, moves },
      changed_ids: moves.map((m) => m.id),
      view: shiftPreviewView(moves, task.id)
    }
  }

  // Real move: the store shifts the task (+ subtree unless --no-cascade) and, when
  // not suppressed, runs one scheduler pass so downstream dependents cascade.
  const before = new Map<string, string>()
  for (const f of flattenTasks(project.tasks)) before.set(f.task.id, `${f.task.start}|${f.task.due}`)
  await ctx.store.shiftTaskDates(project, task.id, delta, { cascadeSubtree: !noCascade, scheduleDownstream })
  const moved: string[] = []
  for (const f of flattenTasks(project.tasks)) {
    if (before.get(f.task.id) !== `${f.task.start}|${f.task.due}`) moved.push(f.task.id)
  }
  return { data: { id: task.id, delta, moved, count: moved.length }, changed_ids: uniq([task.id], moved) }
}

/**
 * Compute — without writing — the set a `shift` would move: the item itself, its
 * subtree (unless `noCascade`), and downstream dependents the scheduler would
 * reschedule. Clones the project, applies the shift + one scheduler pass to the
 * clone, and diffs against the original to name every mover with its old/new date.
 */
function previewShift(
  project: Project,
  task: Task,
  delta: number,
  statuses: ReturnType<PmContext['store']['configFor']>['statuses'],
  noCascade: boolean,
  scheduleDownstream = true
): ShiftMove[] {
  const orig = new Map<string, { start: string; due: string; title: string }>()
  for (const f of flattenTasks(project.tasks)) {
    orig.set(f.task.id, { start: f.task.start, due: f.task.due, title: f.task.title })
  }
  const subtreeIds = new Set(flattenTasks(task.subtasks).map((f) => f.task.id))

  // Apply the shift to a clone: the item always; its descendants unless suppressed.
  const clone = structuredClone(project) as Project
  const cloneRoot = findTaskById(clone, task.id)
  if (cloneRoot) {
    cloneRoot.start = shiftIso(cloneRoot.start, delta)
    cloneRoot.due = shiftIso(cloneRoot.due, delta)
    if (!noCascade) {
      for (const f of flattenTasks(cloneRoot.subtasks)) {
        f.task.start = shiftIso(f.task.start, delta)
        f.task.due = shiftIso(f.task.due, delta)
      }
    }
  }
  // One scheduler pass over the shifted clone → dependents' new dates (skipped
  // when the downstream cascade is suppressed, so the preview matches the write).
  const patches = scheduleDownstream ? computeSchedule(clone.tasks, task.id, statuses).patches : []
  for (const p of patches) {
    const t = findTaskById(clone, p.taskId)
    if (t) {
      t.start = p.start
      t.due = p.due
    }
  }
  const now = new Map<string, { start: string; due: string }>()
  for (const f of flattenTasks(clone.tasks)) now.set(f.task.id, { start: f.task.start, due: f.task.due })

  const moved = (id: string): boolean => {
    const a = orig.get(id)
    const b = now.get(id)
    return a !== undefined && b !== undefined && (a.start !== b.start || a.due !== b.due)
  }
  const rowFor = (id: string, kind: ShiftMove['kind'], label: string): ShiftMove => {
    const a = orig.get(id)!
    const b = now.get(id)!
    return { id, kind, label, old: primaryDate(a), new: primaryDate(b) }
  }

  const moves: ShiftMove[] = []
  if (moved(task.id)) moves.push(rowFor(task.id, 'self', orig.get(task.id)!.title))
  for (const f of flattenTasks(task.subtasks)) {
    if (moved(f.task.id)) moves.push(rowFor(f.task.id, 'subtask', 'subtask'))
  }
  for (const p of patches) {
    if (p.taskId === task.id || subtreeIds.has(p.taskId)) continue
    if (moved(p.taskId)) moves.push(rowFor(p.taskId, 'depends-on', 'depends-on'))
  }
  return moves
}

/** The cascade-preview view (plain text; matches the INT-019 §Appendix mockup). */
function shiftPreviewView(moves: ShiftMove[], rootId: string): ViewSpec {
  // Align child `[id] label` on the widest child id, then align the date column.
  const childIdWidth = Math.max(0, ...moves.slice(1).map((m) => m.id.length + 2))
  const left = (m: ShiftMove, i: number): string => {
    if (i === 0) return `[${m.id}] ${m.label}`
    const idCell = `[${m.id}]`.padEnd(childIdWidth)
    return `   ↳ ${idCell} ${m.label}`
  }
  const lefts = moves.map((m, i) => left(m, i))
  const leftWidth = Math.max(0, ...lefts.map((s) => s.length))
  const lines = moves.map((m, i) => `${lefts[i]!.padEnd(leftWidth)}  ${m.old} → ${m.new}`)
  const count = moves.length
  const footer = `${count} item${count === 1 ? '' : 's'} would move · drop --dry-run to apply · --no-cascade to move only ${rootId}`
  const text = count ? `${lines.join('\n')}\n${footer}` : `No dated items to move.\n${footer}`
  return { format: 'plain', text }
}

// ─── archive / unarchive ────────────────────────────────────────────────────

export async function archive(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const handle = cmd.positionals[0]
  if (!handle) throw new PmError('E_USAGE', 'archive requires a handle')
  const all = await ctx.store.discoverProjects()
  const located = resolveHandle(all, handle)
  if (located.kind !== 'task') throw new PmError('E_NOT_FOUND', 'archive requires a task handle')
  if (!flagBool(cmd.flags, 'dry-run')) await ctx.store.archiveTask(located.project, located.task.id)
  return { data: { id: located.task.id, archived: true }, changed_ids: [located.task.id] }
}

export async function unarchive(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const handle = cmd.positionals[0]
  if (!handle) throw new PmError('E_USAGE', 'unarchive requires a handle')
  const all = await ctx.store.discoverProjects()
  const located = resolveHandle(all, handle)
  if (located.kind !== 'task') throw new PmError('E_NOT_FOUND', 'unarchive requires a task handle')
  if (!flagBool(cmd.flags, 'dry-run')) await ctx.store.unarchiveTask(located.project, located.task.id)
  return { data: { id: located.task.id, archived: false }, changed_ids: [located.task.id] }
}

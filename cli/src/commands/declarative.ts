// Declarative + batch verbs (INT-019 §E): `export` / `snapshot` / `restore`
// serialize the PM subset into the same nested shape `apply` consumes (a portable
// round-trip), and `batch` applies an NDJSON op stream atomically per project.
// All writing delegates to the store's tested mutators inside `transact`, so id
// minting, ordering, backlinks, and the scheduler pass are inherited, never
// re-coded. Nothing here hard-deletes (rm → the store's reversible trash).

import { readFileSync } from 'node:fs'
import type { Project, Task, TaskType } from '../../../src/types'
import { makeTask } from '../../../src/types'
import { findTaskById, flattenTasks, wouldCreateCycle } from '../../../src/store'
import type { PmContext } from '../PmContext'
import { resolveHandle, resolveProjectRef } from '../handles'
import { PmError, type HandlerOutput } from '../envelope'
import type { ParsedCommand } from '../args'
import { coercePatch } from '../coerce'
import { cascadeAfterMutation } from '../schedule'

// ─── portable doc shape (identical to what `apply` consumes) ─────────────────

interface TaskDoc {
  key: string
  title: string
  type?: TaskType
  status?: string
  priority?: string
  start?: string
  due?: string
  assignees?: string[]
  tags?: string[]
  depends_on?: string[]
  subtasks?: TaskDoc[]
}

interface ProjectDoc {
  project: { key: string; title: string; dir: string }
  tasks: TaskDoc[]
}

interface SnapshotDoc {
  projects: ProjectDoc[]
}

function taskToDoc(project: Project, task: Task): TaskDoc {
  const doc: TaskDoc = { key: task.id, title: task.title, type: task.type, status: task.status, priority: task.priority }
  if (task.start) doc.start = task.start
  if (task.due) doc.due = task.due
  if (task.assignees.length) doc.assignees = [...task.assignees]
  if (task.tags.length) doc.tags = [...task.tags]
  if (task.dependencies.length) doc.depends_on = [...task.dependencies]
  if (task.subtasks.length) doc.subtasks = task.subtasks.map((s) => taskToDoc(project, s))
  return doc
}

function projectToDoc(project: Project): ProjectDoc {
  return {
    project: { key: project.id, title: project.title, dir: project.path ?? '' },
    tasks: project.tasks.map((t) => taskToDoc(project, t))
  }
}

// ─── export ───────────────────────────────────────────────────────────────────

export async function exportProject(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const ref = cmd.positionals[0]
  if (!ref) throw new PmError('E_USAGE', 'export requires a project')
  const all = await ctx.store.discoverProjects()
  const project = resolveProjectRef(all, ref)
  const doc = projectToDoc(project)
  return { data: doc as unknown as Record<string, unknown>, view: { format: 'plain', text: JSON.stringify(doc, null, 2) } }
}

// ─── snapshot ─────────────────────────────────────────────────────────────────

export async function snapshot(ctx: PmContext): Promise<HandlerOutput> {
  const all = await ctx.store.discoverProjects()
  const doc: SnapshotDoc = { projects: all.map((p) => projectToDoc(p)) }
  return { data: doc as unknown as Record<string, unknown>, view: { format: 'plain', text: JSON.stringify(doc, null, 2) } }
}

// ─── restore ──────────────────────────────────────────────────────────────────

interface FlatDoc {
  node: TaskDoc
  key: string
  parentKey: string | null
}

function flattenDoc(nodes: TaskDoc[] | undefined, parentKey: string | null, out: FlatDoc[]): void {
  for (const node of nodes ?? []) {
    const key = node.key || node.title
    out.push({ node, key, parentKey })
    if (node.subtasks?.length) flattenDoc(node.subtasks, key, out)
  }
}

/** Spec-declared scalar/array fields as a typed patch (for build + diff). */
function docPatch(node: TaskDoc): Partial<Task> {
  const patch: Partial<Task> = {}
  if (node.title !== undefined) patch.title = node.title
  if (node.type !== undefined) patch.type = node.type
  if (node.status !== undefined) patch.status = node.status
  if (node.priority !== undefined) patch.priority = node.priority
  if (node.start !== undefined) patch.start = node.start
  if (node.due !== undefined) patch.due = node.due
  if (node.assignees !== undefined) patch.assignees = node.assignees
  if (node.tags !== undefined) patch.tags = node.tags
  return patch
}

function diffPatch(task: Task, patch: Partial<Task>): Partial<Task> {
  const out: Partial<Task> = {}
  for (const [k, v] of Object.entries(patch)) {
    const current = (task as unknown as Record<string, unknown>)[k]
    if (Array.isArray(v)) {
      if ([...v].sort().join(' ') !== (Array.isArray(current) ? [...(current as string[])].sort().join(' ') : '')) {
        ;(out as Record<string, unknown>)[k] = v
      }
    } else if (current !== v) {
      ;(out as Record<string, unknown>)[k] = v
    }
  }
  return out
}

async function restoreOneProject(ctx: PmContext, all: Project[], doc: ProjectDoc): Promise<string[]> {
  const changed: string[] = []
  let project = all.find((p) => p.title === doc.project.title)
  if (!project) {
    project = await ctx.store.createProject(doc.project.title, doc.project.dir ?? '')
    changed.push(project.id)
  }

  const flat: FlatDoc[] = []
  flattenDoc(doc.tasks, null, flat)
  const keyToId: Record<string, string> = {}

  // Upsert each node pre-order (parents before children), matching an existing
  // task by title under the resolved parent so re-restore is not duplicative.
  for (const { node, key, parentKey } of flat) {
    const parentId = parentKey ? (keyToId[parentKey] ?? null) : null
    const existing = flattenTasks(project.tasks).find(
      (f) => f.parentId === parentId && f.task.title === node.title
    )?.task
    if (existing) {
      const patch = diffPatch(existing, docPatch(node))
      if (Object.keys(patch).length) {
        await ctx.store.updateTask(project, existing.id, patch)
        changed.push(existing.id)
      }
      keyToId[key] = existing.id
    } else {
      const task = makeTask(docPatch(node))
      await ctx.store.insertTask(project, task, parentId)
      keyToId[key] = task.id
      changed.push(task.id)
    }
  }

  // Wire dependencies by key (union with any existing edges; never removes).
  for (const { node, key } of flat) {
    if (!node.depends_on?.length) continue
    const taskId = keyToId[key]
    const task = taskId ? findTaskById(project, taskId) : null
    if (!task || !taskId) continue
    const resolved = node.depends_on.map((k) => keyToId[k] ?? k).filter((id) => findTaskById(project, id))
    const next = [...new Set([...task.dependencies, ...resolved])]
    if (next.sort().join(' ') !== [...task.dependencies].sort().join(' ')) {
      await ctx.store.updateTask(project, taskId, { dependencies: next })
      changed.push(taskId)
    }
  }

  if (changed.length) {
    const moved = await cascadeAfterMutation(ctx, project)
    for (const id of moved) if (!changed.includes(id)) changed.push(id)
  }
  return changed
}

export async function restore(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const path = cmd.positionals[0]
  if (!path) throw new PmError('E_USAGE', 'restore requires a snapshot/export file path')
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    throw new PmError('E_USAGE', `could not read "${path}": ${e instanceof Error ? e.message : String(e)}`)
  }
  // Accept a whole-vault snapshot (`{projects:[…]}`) or a single project export.
  const docs: ProjectDoc[] =
    raw && typeof raw === 'object' && 'projects' in (raw as object)
      ? ((raw as SnapshotDoc).projects ?? [])
      : [raw as ProjectDoc]

  const changed: string[] = []
  for (const doc of docs) {
    if (!doc?.project?.title) throw new PmError('E_USAGE', 'each project doc requires project.title')
    const all = await ctx.store.discoverProjects()
    const ids = await restoreOneProject(ctx, all, doc)
    for (const id of ids) if (!changed.includes(id)) changed.push(id)
  }
  return {
    data: { projects: docs.length, restored: changed },
    changed_ids: changed,
    view: { format: 'plain', text: `restored ${docs.length} project${docs.length === 1 ? '' : 's'} · ${changed.length} entities touched` }
  }
}

// ─── batch (atomic NDJSON op stream) ─────────────────────────────────────────

type OpName = 'new_task' | 'new_subtask' | 'new_milestone' | 'set' | 'depend' | 'undepend' | 'mv' | 'archive' | 'rm' | 'note'

interface BatchOp {
  op: OpName
  project?: string
  handle?: string
  key?: string
  title?: string
  patch?: Record<string, unknown>
  on?: string[]
  under?: string
}

const OP_NAMES = new Set<OpName>(['new_task', 'new_subtask', 'new_milestone', 'set', 'depend', 'undepend', 'mv', 'archive', 'rm', 'note'])
const NEW_OPS = new Set<OpName>(['new_task', 'new_subtask', 'new_milestone'])

interface OpResult {
  index: number
  ok: boolean
  id?: string
  error?: string
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** Structural validation of one op; returns an error string or null. */
function validateOp(op: BatchOp): string | null {
  if (!op || typeof op !== 'object') return 'op is not an object'
  if (!OP_NAMES.has(op.op)) return `unknown op "${String(op.op)}"`
  if (NEW_OPS.has(op.op)) {
    if (!op.project) return `${op.op} requires "project"`
    if (!op.title) return `${op.op} requires "title"`
    return null
  }
  if (!op.handle) return `${op.op} requires "handle"`
  if (op.op === 'set' && (!op.patch || typeof op.patch !== 'object')) return 'set requires "patch"'
  if (op.op === 'note') {
    const p = op.patch ?? {}
    if (!('set' in p) && !('append' in p) && !('prepend' in p)) return 'note requires patch.set|append|prepend'
  }
  if ((op.op === 'depend' || op.op === 'undepend') && (!Array.isArray(op.on) || op.on.length === 0)) return `${op.op} requires "on"`
  if (op.op === 'mv' && op.under === undefined) return 'mv requires "under"'
  return null
}

/** Normalize a JSON patch object into the `field=value` string map coercePatch wants. */
function stringPatch(patch: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(patch)) out[k] = Array.isArray(v) ? v.join(',') : String(v)
  return out
}

export async function batch(ctx: PmContext): Promise<HandlerOutput> {
  const text = await readStdin()
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)

  // ── Parse + validate EVERY op first; any malformed → E_BATCH, nothing written ──
  const ops: BatchOp[] = []
  const validationErrors: string[] = []
  lines.forEach((line, i) => {
    let parsed: BatchOp
    try {
      parsed = JSON.parse(line) as BatchOp
    } catch {
      validationErrors.push(`line ${i + 1}: invalid JSON`)
      return
    }
    const err = validateOp(parsed)
    if (err) validationErrors.push(`line ${i + 1}: ${err}`)
    else ops.push(parsed)
  })
  if (validationErrors.length) {
    throw new PmError('E_BATCH', `batch rejected — ${validationErrors.length} invalid op(s): ${validationErrors.join('; ')}`)
  }

  const all = await ctx.store.discoverProjects()

  // A key created by a new_* op belongs to that op's project — so key-referencing
  // ops downstream can be grouped to the right project.
  const keyProjectRef = new Map<string, string>()
  for (const op of ops) if (NEW_OPS.has(op.op) && op.key && op.project) keyProjectRef.set(op.key, op.project)

  const projectRefOf = (op: BatchOp): string => {
    if (NEW_OPS.has(op.op)) return op.project!
    const h = op.handle!
    return keyProjectRef.get(h) ?? h
  }

  // Group op indices by resolved project (preserving original order per project).
  const groups = new Map<string, { project: Project; indices: number[] }>()
  const results: OpResult[] = ops.map((_, index) => ({ index, ok: false }))
  ops.forEach((op, index) => {
    let project: Project
    try {
      const ref = projectRefOf(op)
      project = NEW_OPS.has(op.op) ? resolveProjectRef(all, ref) : resolveHandle(all, ref).project
    } catch (e) {
      results[index] = { index, ok: false, error: e instanceof Error ? e.message : String(e) }
      return
    }
    const g = groups.get(project.filePath) ?? { project, indices: [] }
    g.indices.push(index)
    groups.set(project.filePath, g)
  })

  const changed: string[] = []

  for (const { project, indices } of groups.values()) {
    const keyToId: Record<string, string> = {}
    const localTouched: string[] = []
    try {
      await ctx.store.transact(project, async () => {
        for (const index of indices) {
          const op = ops[index]!
          const id = await applyOp(ctx, project, op, keyToId)
          results[index] = { index, ok: true, id }
          if (id) localTouched.push(id)
        }
      })
      for (const id of localTouched) if (!changed.includes(id)) changed.push(id)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      // transact rolled the whole project group back — mark every op failed.
      for (const index of indices) {
        results[index] = results[index]?.ok ? { index, ok: false, error: `rolled back: ${message}` } : { index, ok: false, error: message }
      }
    }
  }

  return { data: { results }, changed_ids: changed }
}

/** Resolve a batch handle: an in-batch key first, else a real handle in-project. */
function resolveInBatch(project: Project, keyToId: Record<string, string>, ref: string): string {
  if (keyToId[ref]) return keyToId[ref]!
  const located = resolveHandle([project], ref)
  if (located.kind !== 'task') throw new PmError('E_NOT_FOUND', `handle "${ref}" is not a task`)
  return located.task.id
}

/** Apply one validated op inside an open transaction; returns the affected id. */
async function applyOp(ctx: PmContext, project: Project, op: BatchOp, keyToId: Record<string, string>): Promise<string> {
  switch (op.op) {
    case 'new_task':
    case 'new_subtask':
    case 'new_milestone': {
      const type: TaskType = op.op === 'new_subtask' ? 'subtask' : op.op === 'new_milestone' ? 'milestone' : 'task'
      const patch = op.patch ? coercePatch(stringPatch(op.patch)) : {}
      const parentId = op.under && op.under !== 'root' ? resolveInBatch(project, keyToId, op.under) : null
      const task = makeTask({ ...patch, title: op.title, type })
      await ctx.store.insertTask(project, task, parentId)
      if (op.key) keyToId[op.key] = task.id
      return task.id
    }
    case 'set': {
      const id = resolveInBatch(project, keyToId, op.handle!)
      await ctx.store.updateTask(project, id, coercePatch(stringPatch(op.patch ?? {})))
      return id
    }
    case 'note': {
      const id = resolveInBatch(project, keyToId, op.handle!)
      const task = findTaskById(project, id)!
      await ctx.store.loadTaskBody(task)
      const current = task.description ?? ''
      const p = op.patch ?? {}
      let next = current
      if (typeof p.set === 'string') next = p.set
      else if (typeof p.append === 'string') next = current ? `${current}\n\n${p.append}` : p.append
      else if (typeof p.prepend === 'string') next = current ? `${p.prepend}\n\n${current}` : p.prepend
      await ctx.store.updateTask(project, id, { description: next })
      return id
    }
    case 'depend': {
      const id = resolveInBatch(project, keyToId, op.handle!)
      const task = findTaskById(project, id)!
      const edges = (op.on ?? []).map((r) => resolveInBatch(project, keyToId, r))
      for (const edgeId of edges) {
        if (wouldCreateCycle(project.tasks, id, edgeId)) {
          throw new PmError('E_CYCLE', `dependency ${id} → ${edgeId} would create a cycle`, [id, edgeId])
        }
      }
      await ctx.store.updateTask(project, id, { dependencies: [...new Set([...task.dependencies, ...edges])] })
      return id
    }
    case 'undepend': {
      const id = resolveInBatch(project, keyToId, op.handle!)
      const task = findTaskById(project, id)!
      const edges = new Set((op.on ?? []).map((r) => resolveInBatch(project, keyToId, r)))
      await ctx.store.updateTask(project, id, { dependencies: task.dependencies.filter((d) => !edges.has(d)) })
      return id
    }
    case 'mv': {
      const id = resolveInBatch(project, keyToId, op.handle!)
      const parentId = op.under && op.under !== 'root' ? resolveInBatch(project, keyToId, op.under) : null
      await ctx.store.moveTask(project, id, parentId)
      return id
    }
    case 'archive': {
      const id = resolveInBatch(project, keyToId, op.handle!)
      await ctx.store.archiveTask(project, id)
      return id
    }
    case 'rm': {
      const id = resolveInBatch(project, keyToId, op.handle!)
      await ctx.store.deleteTask(project, id)
      return id
    }
    default:
      throw new PmError('E_BATCH', `unhandled op "${String(op.op)}"`)
  }
}

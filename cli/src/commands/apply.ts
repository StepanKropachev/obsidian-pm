// `apply <spec>` — declarative, idempotent project-as-code upsert.
//
// A spec (YAML/JSON, from a file path or `-` for stdin) describes a whole nested
// project. Every node carries a client-supplied stable `key`; `apply` maps each
// key to a real minted id and persists that mapping in a CLI-owned sidecar so
// re-applying an unchanged spec is a NO-OP (create missing → update changed →
// leave equal). The store's tested mutators (`createProject`/`insertTask`/
// `updateTask`/`reorderTask`/`moveProject`/`renameProject`/`archiveTask`) do all
// the writing, wrapped in a single `transact` (one save + one schedule pass);
// `apply` only diffs and orchestrates.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseYaml } from 'obsidian'
import type { Project, Task } from '../../../src/types'
import { makeTask } from '../../../src/types'
import { findTaskById, flattenTasks } from '../../../src/store'
import type { PmContext } from '../PmContext'
import { PmError, type HandlerOutput } from '../envelope'
import type { ParsedCommand } from '../args'
import { flagBool } from '../args'
import type { ViewSpec } from '../render'

// ─── Spec shape ─────────────────────────────────────────────────────────────

interface SpecNode {
  key?: string
  title: string
  status?: string
  priority?: string
  due?: string
  start?: string
  type?: Task['type']
  assignees?: string[]
  tags?: string[]
  depends_on?: string[]
  subtasks?: SpecNode[]
}

interface Spec {
  project: { key?: string; title: string; dir?: string; icon?: string; color?: string; description?: string }
  tasks?: SpecNode[]
}

// ─── key→id sidecar (CLI-owned, survives store frontmatter rewrites) ────────

interface KeyEntry {
  projectId: string
  tasks: Record<string, string>
}
type KeyMap = Record<string, KeyEntry>

function keyMapPath(vaultRoot: string): string {
  return join(vaultRoot, '.obsidian', 'plugins', 'project-manager', 'pm-cli-keys.json')
}

function loadKeyMap(vaultRoot: string): KeyMap {
  try {
    return JSON.parse(readFileSync(keyMapPath(vaultRoot), 'utf8')) as KeyMap
  } catch {
    return {}
  }
}

function saveKeyMap(vaultRoot: string, map: KeyMap): void {
  const p = keyMapPath(vaultRoot)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(map, null, 2))
}

// ─── Spec traversal + diffing ───────────────────────────────────────────────

/** A flattened spec node paired with its parent key (null at the top level). */
interface FlatNode {
  node: SpecNode
  key: string
  parentKey: string | null
}

/** Pre-order flatten of the spec forest, tracking each node's (parent) key. */
function flattenSpec(nodes: SpecNode[] | undefined, parentKey: string | null, out: FlatNode[]): void {
  for (const node of nodes ?? []) {
    const key = node.key ?? node.title
    out.push({ node, key, parentKey })
    if (node.subtasks?.length) flattenSpec(node.subtasks, key, out)
  }
}

/** The subset of spec-declared scalar/array fields, for building/diffing a Task. */
function specPatch(node: SpecNode): Partial<Task> {
  const patch: Partial<Task> = {}
  if (node.title !== undefined) patch.title = node.title
  if (node.status !== undefined) patch.status = node.status
  if (node.priority !== undefined) patch.priority = node.priority
  if (node.due !== undefined) patch.due = node.due
  if (node.start !== undefined) patch.start = node.start
  if (node.type !== undefined) patch.type = node.type
  if (node.assignees !== undefined) patch.assignees = node.assignees
  if (node.tags !== undefined) patch.tags = node.tags
  return patch
}

/** Fields of `patch` that differ from `task`; empty means the node is up to date. */
function diffPatch(task: Task, patch: Partial<Task>): Partial<Task> {
  const out: Partial<Task> = {}
  for (const [k, v] of Object.entries(patch)) {
    const current = (task as unknown as Record<string, unknown>)[k]
    if (Array.isArray(v)) {
      const a = [...v].sort().join(' ')
      const b = Array.isArray(current) ? [...(current as string[])].sort().join(' ') : ''
      if (a !== b) (out as Record<string, unknown>)[k] = v
    } else if (current !== v) {
      ;(out as Record<string, unknown>)[k] = v
    }
  }
  return out
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

/** A `start|due` fingerprint per task id, to name scheduler-moved tasks post-commit. */
function dateFingerprint(project: Project): Map<string, string> {
  const map = new Map<string, string>()
  for (const f of flattenTasks(project.tasks)) map.set(f.task.id, `${f.task.start}|${f.task.due}`)
  return map
}

// ─── Terraform-style diff (dry-run) ──────────────────────────────────────────

interface DiffPlan {
  creates: string[] // titles
  updates: Array<{ id: string; fields: string[] }>
  archives: Array<{ id: string; title: string }>
  changedIds: string[]
}

function renderDiff(plan: DiffPlan): ViewSpec {
  const lines: string[] = []
  for (const title of plan.creates) lines.push(`+ create ${title}`)
  for (const u of plan.updates) lines.push(`~ update [${u.id}] ${u.fields.join(', ')}`)
  for (const a of plan.archives) lines.push(`- archive [${a.id}] ${a.title}`)
  const summary = `${plan.creates.length} to create · ${plan.updates.length} to update · ${plan.archives.length} to archive`
  const body = lines.length ? lines.join('\n') : 'no changes'
  return { format: 'plain', text: `${body}\n\n${summary} · dry run — nothing written` }
}

// ─── The apply orchestration ────────────────────────────────────────────────

export async function apply(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const specPath = cmd.positionals[0]
  if (!specPath) throw new PmError('E_USAGE', 'apply requires a spec path (or "-" for stdin)')
  const dryRun = flagBool(cmd.flags, 'dry-run') || flagBool(cmd.flags, 'diff')
  const prune = flagBool(cmd.flags, 'prune')

  let spec: Spec
  try {
    const raw = specPath === '-' ? readFileSync(0, 'utf8') : readFileSync(specPath, 'utf8')
    spec = parseYaml(raw) as Spec
  } catch (e) {
    throw new PmError('E_USAGE', `could not read spec "${specPath}": ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!spec?.project?.title) throw new PmError('E_USAGE', 'spec requires project.title')

  const keyMap = loadKeyMap(ctx.vaultRoot)
  const projectKey = spec.project.key ?? spec.project.title
  const entry: KeyEntry = keyMap[projectKey] ?? { projectId: '', tasks: {} }

  const flat: FlatNode[] = []
  flattenSpec(spec.tasks, null, flat)
  const specKeys = new Set(flat.map((f) => f.key))

  // ── Resolve the project (by mapped id, else by title on first run) ──
  const all = await ctx.store.discoverProjects()
  let project =
    (entry.projectId ? all.find((p) => p.id === entry.projectId) : undefined) ??
    all.find((p) => p.title === spec.project.title)

  // ── Dry-run: compute the diff against current state, WRITE NOTHING ──
  if (dryRun) {
    const plan: DiffPlan = { creates: [], updates: [], archives: [], changedIds: [] }
    const keyToId = { ...entry.tasks }

    if (!project) {
      plan.creates.push(spec.project.title)
      plan.changedIds.push(projectKey)
      for (const { node } of flat) {
        plan.creates.push(node.title)
        plan.changedIds.push(node.key ?? node.title)
      }
      const view = renderDiff(plan)
      return { data: { project: projectKey, dry_run: true, plan: view.text }, view, changed_ids: plan.changedIds }
    }

    // Project drift (dir → move, title → rename) reads as an update on the project.
    const projFields: string[] = []
    if (spec.project.dir && normalize(spec.project.dir) !== normalize(ctx.store.projectDirectory(project))) {
      projFields.push('dir')
    }
    if (spec.project.title !== project.title) projFields.push('title')
    if (projFields.length) {
      plan.updates.push({ id: project.id, fields: projFields })
      plan.changedIds.push(project.id)
    }

    for (const { node, key } of flat) {
      const existing = keyToId[key] ? findTaskById(project, keyToId[key]!) : null
      if (existing) {
        const patch = diffPatch(existing, specPatch(node))
        if (Object.keys(patch).length > 0) {
          plan.updates.push({ id: existing.id, fields: Object.keys(patch) })
          plan.changedIds.push(existing.id)
        }
      } else {
        plan.creates.push(node.title)
        plan.changedIds.push(key)
      }
    }

    if (prune) {
      for (const [oldKey, oldId] of Object.entries(entry.tasks)) {
        if (specKeys.has(oldKey)) continue
        const stale = findTaskById(project, oldId)
        if (stale && !stale.archived) {
          plan.archives.push({ id: oldId, title: stale.title })
          plan.changedIds.push(oldId)
        }
      }
    }

    const view = renderDiff(plan)
    return {
      data: { project: project.id, dry_run: true, plan: view.text },
      view,
      changed_ids: [...new Set(plan.changedIds)]
    }
  }

  // ── Real run ──
  const changed: string[] = []

  // Project create / drift happen OUTSIDE the transact (they are their own
  // file operations; the project must exist before we can transact on it).
  if (!project) {
    project = await ctx.store.createProject(spec.project.title, spec.project.dir ?? '')
    changed.push(project.id)
    if (spec.project.icon || spec.project.color || spec.project.description) {
      if (spec.project.icon) project.icon = spec.project.icon
      if (spec.project.color) project.color = spec.project.color
      if (spec.project.description) project.description = spec.project.description
      await ctx.store.saveProject(project)
    }
  } else {
    if (spec.project.dir && normalize(spec.project.dir) !== normalize(ctx.store.projectDirectory(project))) {
      await ctx.store.moveProject(project, spec.project.dir)
      changed.push(project.id)
    }
    if (spec.project.title !== project.title) {
      await ctx.store.renameProject(project, spec.project.title)
      changed.push(project.id)
    }
  }
  entry.projectId = project.id

  const keyToId: Record<string, string> = { ...entry.tasks }
  const before = dateFingerprint(project)

  await ctx.store.transact(project, async () => {
    // Upsert each node (pre-order, parents before children).
    for (const { node, key, parentKey } of flat) {
      const parentId = parentKey ? (keyToId[parentKey] ?? null) : null
      const existing = keyToId[key] ? findTaskById(project!, keyToId[key]!) : null
      if (existing) {
        const patch = diffPatch(existing, specPatch(node))
        if (Object.keys(patch).length > 0) {
          await ctx.store.updateTask(project!, existing.id, patch)
          changed.push(existing.id)
        }
        keyToId[key] = existing.id
      } else {
        const task = makeTask(specPatch(node))
        await ctx.store.insertTask(project!, task, parentId)
        keyToId[key] = task.id
        changed.push(task.id)
      }
    }

    // Resolve depends_on by key→id now that every node exists (forward refs OK).
    for (const { node, key } of flat) {
      if (!node.depends_on?.length) continue
      const taskId = keyToId[key]
      const task = taskId ? findTaskById(project!, taskId) : null
      if (!task || !taskId) continue
      const resolved = node.depends_on.map((k) => keyToId[k] ?? k)
      const next = [...new Set([...task.dependencies, ...resolved])]
      if (!arraysEqual([...next].sort(), [...task.dependencies].sort())) {
        await ctx.store.updateTask(project!, taskId, { dependencies: next })
        changed.push(taskId)
      }
    }

    // Sibling order follows spec order — reorder only when actually out of order.
    const groups = new Map<string | null, string[]>()
    for (const { key, parentKey } of flat) {
      const g = groups.get(parentKey) ?? []
      g.push(key)
      groups.set(parentKey, g)
    }
    for (const [parentKey, keys] of groups) {
      const desiredIds = keys.map((k) => keyToId[k]).filter((id): id is string => Boolean(id))
      if (desiredIds.length < 2) continue
      const siblings =
        parentKey === null ? project!.tasks : (findTaskById(project!, keyToId[parentKey] ?? '')?.subtasks ?? [])
      const actual = siblings.map((t) => t.id).filter((id) => desiredIds.includes(id))
      if (arraysEqual(actual, desiredIds)) continue
      for (let i = 1; i < desiredIds.length; i++) {
        await ctx.store.reorderTask(project!, desiredIds[i]!, desiredIds[i - 1]!, 'after')
        if (!changed.includes(desiredIds[i]!)) changed.push(desiredIds[i]!)
      }
    }

    // Prune: archive previously-managed tasks now absent from the spec.
    if (prune) {
      for (const [oldKey, oldId] of Object.entries(entry.tasks)) {
        if (specKeys.has(oldKey)) continue
        const stale = findTaskById(project!, oldId)
        if (stale && !stale.archived) {
          await ctx.store.archiveTask(project!, oldId)
          changed.push(oldId)
        }
        delete keyToId[oldKey]
      }
    }
  })

  // Name any tasks the commit's schedule pass moved.
  for (const f of flattenTasks(project.tasks)) {
    const now = `${f.task.start}|${f.task.due}`
    const prev = before.get(f.task.id)
    if (prev !== undefined && prev !== now && !changed.includes(f.task.id)) changed.push(f.task.id)
  }

  entry.tasks = keyToId
  keyMap[projectKey] = entry
  saveKeyMap(ctx.vaultRoot, keyMap)

  return { data: { project: project.id }, changed_ids: [...new Set(changed)] }
}

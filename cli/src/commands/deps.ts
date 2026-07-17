// Dependency verbs: `depend <handle> --on <handle…>` (cycle-guarded) and
// `undepend`. The cycle check reuses the store's `wouldCreateCycle` — the same
// invariant the plugin's dependency picker enforces — and rejects with E_CYCLE
// (exit 5) BEFORE any write. Wiring itself is a `updateTask({dependencies})`
// patch, followed by the default-on schedule cascade.

import type { Project } from '../../../src/types'
import { wouldCreateCycle } from '../../../src/store'
import type { PmContext } from '../PmContext'
import { resolveHandle } from '../handles'
import { PmError, type HandlerOutput } from '../envelope'
import type { ParsedCommand } from '../args'
import { flagBool, flagList } from '../args'
import { cascadeAfterMutation } from '../schedule'

/** Resolve a set of `--on` refs to task ids within the given project. */
function resolveEdges(project: Project, refs: string[]): string[] {
  const ids: string[] = []
  for (const ref of refs) {
    const located = resolveHandle([project], ref)
    if (located.kind !== 'task') throw new PmError('E_NOT_FOUND', `dependency handle "${ref}" is not a task`)
    ids.push(located.task.id)
  }
  return ids
}

/** `depend <handle> --on <handle…>` — cycle-guard each edge, then wire + cascade. */
export async function depend(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const handle = cmd.positionals[0]
  if (!handle) throw new PmError('E_USAGE', 'depend requires a handle')
  const onRefs = flagList(cmd.flags, 'on')
  if (onRefs.length === 0) throw new PmError('E_USAGE', 'depend requires --on <handle…>')

  const all = await ctx.store.discoverProjects()
  const located = resolveHandle(all, handle)
  if (located.kind !== 'task') throw new PmError('E_NOT_FOUND', 'depend requires a task handle')
  const { project, task } = located

  const edges = resolveEdges(project, onRefs)
  for (const edgeId of edges) {
    // "task depends on edgeId": reject if edgeId already (transitively) depends on task.
    if (wouldCreateCycle(project.tasks, task.id, edgeId)) {
      throw new PmError('E_CYCLE', `dependency ${task.id} → ${edgeId} would create a cycle`, [task.id, edgeId])
    }
  }
  const next = [...new Set([...task.dependencies, ...edges])]
  return writeDeps(ctx, cmd, project, task.id, next)
}

/** `undepend <handle> --on <handle…>` — drop the named edges, then cascade. */
export async function undepend(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const handle = cmd.positionals[0]
  if (!handle) throw new PmError('E_USAGE', 'undepend requires a handle')
  const onRefs = flagList(cmd.flags, 'on')
  if (onRefs.length === 0) throw new PmError('E_USAGE', 'undepend requires --on <handle…>')

  const all = await ctx.store.discoverProjects()
  const located = resolveHandle(all, handle)
  if (located.kind !== 'task') throw new PmError('E_NOT_FOUND', 'undepend requires a task handle')
  const { project, task } = located

  const edges = resolveEdges(project, onRefs)
  const next = task.dependencies.filter((d) => !edges.includes(d))
  return writeDeps(ctx, cmd, project, task.id, next)
}

async function writeDeps(
  ctx: PmContext,
  cmd: ParsedCommand,
  project: Project,
  taskId: string,
  next: string[]
): Promise<HandlerOutput> {
  if (flagBool(cmd.flags, 'dry-run')) return { data: { id: taskId, dependencies: next }, changed_ids: [taskId] }
  await ctx.store.updateTask(project, taskId, { dependencies: next })
  const scheduled =
    flagBool(cmd.flags, 'no-cascade') || flagBool(cmd.flags, 'no-schedule')
      ? []
      : await cascadeAfterMutation(ctx, project, taskId)
  return { data: { id: taskId, dependencies: next, scheduled }, changed_ids: [...new Set([taskId, ...scheduled])] }
}

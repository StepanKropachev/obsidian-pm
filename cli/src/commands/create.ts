// Create verbs: `new project`, `new task`, `new subtask`, `new milestone`, and
// `import`. Every create delegates to the store — `createProject` / `insertTask`
// / `importNoteAsTask` — so id minting, the INT-020 nested layout, the INT-021
// managed backlink, ordering, and completion-stamping are all inherited, not
// re-coded. Parent targeting resolves through `resolveHandle`, so a parent may be
// addressed by id, slug-path, or title exactly like every other command.

import { TFile } from 'obsidian'
import type { Task, TaskType } from '../../../src/types'
import { makeTask } from '../../../src/types'
import { findTaskById } from '../../../src/store'
import type { PmContext } from '../PmContext'
import { resolveHandle, resolveProjectRef } from '../handles'
import { PmError, type HandlerOutput } from '../envelope'
import type { FlagMap, ParsedCommand } from '../args'
import { flagList, flagStr } from '../args'

/** True when a flag was supplied at all (boolean-registered or bare value flag). */
function flagPresent(flags: FlagMap, name: string): boolean {
  return name in flags && flags[name] !== false
}

/**
 * The explicit parent-task handle for a `new` verb: `--under` with its accepted
 * aliases `--milestone`/`--parent`. (`--project` is handled separately: it scopes
 * the PROJECT, and — when a parent handle is also present — names the container.)
 */
function parentTaskFlag(flags: FlagMap): string | undefined {
  return flagStr(flags, 'under') ?? flagStr(flags, 'milestone') ?? flagStr(flags, 'parent')
}

/** Assemble a `Partial<Task>` from create flags for a resolved title + type. */
function overridesFromFlags(cmd: ParsedCommand, type: TaskType, title: string): Partial<Task> {
  const f = cmd.flags
  const overrides: Partial<Task> = { title, type }
  const status = flagStr(f, 'status')
  const priority = flagStr(f, 'priority')
  const due = flagStr(f, 'due')
  const start = flagStr(f, 'start')
  const desc = flagStr(f, 'desc')
  const estimate = flagStr(f, 'estimate')
  const assignees = flagList(f, 'assignee')
  const tags = flagList(f, 'tag')
  if (status) overrides.status = status
  if (priority) overrides.priority = priority
  if (due !== undefined && due !== '') overrides.due = due
  if (start !== undefined && start !== '') overrides.start = start
  if (desc) overrides.description = desc
  if (estimate && !Number.isNaN(Number(estimate))) overrides.timeEstimate = Number(estimate)
  if (assignees.length) overrides.assignees = assignees
  if (tags.length) overrides.tags = tags
  return overrides
}

export async function newProject(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const title = flagStr(cmd.flags, 'title') ?? cmd.positionals[0]
  if (!title) throw new PmError('E_USAGE', 'a title is required')
  const dir = flagStr(cmd.flags, 'dir') ?? ''
  const project = await ctx.store.createProject(title, dir)

  // `--icon/--color/--desc` are project metadata; set them and persist once.
  const icon = flagStr(cmd.flags, 'icon')
  const color = flagStr(cmd.flags, 'color')
  const desc = flagStr(cmd.flags, 'desc')
  if (icon) project.icon = icon
  if (color) project.color = color
  if (desc) project.description = desc
  if (icon || color || desc) await ctx.store.saveProject(project)

  return {
    data: { id: project.id, filePath: project.filePath, path: project.path ?? dir, title: project.title },
    changed_ids: [project.id]
  }
}

async function createTask(ctx: PmContext, cmd: ParsedCommand, type: TaskType): Promise<HandlerOutput> {
  const projects = await ctx.store.discoverProjects()

  const projectRef = flagStr(cmd.flags, 'project')
  const parentRef = parentTaskFlag(cmd.flags)

  // Title resolution. `--title` wins; otherwise the trailing positional is the
  // title. When no project/parent flag scopes the create, a two-positional form
  // `new task <parent-handle> <title>` puts the parent first.
  let title = flagStr(cmd.flags, 'title')
  const pos = cmd.positionals
  let positionalParent: string | undefined
  if (title === undefined) {
    if (projectRef !== undefined || parentRef !== undefined) {
      title = pos[0]
    } else if (pos.length >= 2) {
      positionalParent = pos[0]
      title = pos[1]
    } else {
      title = pos[0]
    }
  } else if (projectRef === undefined && parentRef === undefined && pos.length >= 1) {
    positionalParent = pos[0]
  }
  if (!title) throw new PmError('E_USAGE', 'a title is required')

  // Resolve the owning project and (optional) parent task.
  let project
  let parentId: string | null = null
  if (projectRef !== undefined) {
    project = resolveProjectRef(projects, projectRef)
    if (parentRef !== undefined) {
      let parent = findTaskById(project, parentRef)
      if (!parent) {
        const loc = resolveHandle(projects, parentRef)
        if (loc.kind === 'task' && loc.project.id === project.id) parent = loc.task
      }
      if (!parent) throw new PmError('E_NOT_FOUND', `parent "${parentRef}" not found in project`)
      parentId = parent.id
    }
  } else {
    const handle = parentRef ?? positionalParent
    if (!handle) {
      throw new PmError('E_USAGE', `a project or parent handle is required (pass --project/--under)`)
    }
    const located = resolveHandle(projects, handle)
    project = located.project
    parentId = located.kind === 'task' ? located.task.id : null
  }

  if (type === 'subtask' && parentId === null) {
    throw new PmError('E_USAGE', 'a subtask requires a parent task handle')
  }

  const task = makeTask(overridesFromFlags(cmd, type, title))

  // E_CONFLICT preflight: never let the store's own save collide silently.
  const conflict = ctx.store.findTaskFileConflict(project, task)
  if (conflict) throw new PmError('E_CONFLICT', conflict.message ?? 'filename conflict', [task.id])

  await ctx.store.insertTask(project, task, parentId)

  // `--after`/`--before` resequence among siblings (never establishes parentage).
  const after = flagStr(cmd.flags, 'after')
  const before = flagStr(cmd.flags, 'before')
  if (after || before) {
    const sibRef = (after ?? before)!
    const sib = resolveHandle(projects, sibRef)
    if (sib.kind !== 'task') throw new PmError('E_USAGE', `--${after ? 'after' : 'before'} needs a sibling task handle`)
    await ctx.store.reorderTask(project, task.id, sib.task.id, after ? 'after' : 'before')
  }

  return {
    data: { id: task.id, filePath: task.filePath ?? '', parentId, type: task.type },
    changed_ids: [task.id]
  }
}

export function newTask(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  return createTask(ctx, cmd, 'task')
}

export function newSubtask(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  return createTask(ctx, cmd, 'subtask')
}

export function newMilestone(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  return createTask(ctx, cmd, 'milestone')
}

/**
 * `import <note> --into <project> [--move|--copy]` — convert an existing note
 * into a task under a project. Delegates to `importNoteAsTask`, so the note's
 * body becomes the task description and (with `--move`) the source file itself
 * becomes the task file. `--copy` (the default) leaves the source untouched.
 */
export async function importNote(ctx: PmContext, cmd: ParsedCommand): Promise<HandlerOutput> {
  const notePath = flagStr(cmd.flags, 'note') ?? cmd.positionals[0]
  if (!notePath) throw new PmError('E_USAGE', 'import requires a note path')
  const projectRef = flagStr(cmd.flags, 'into')
  if (!projectRef) throw new PmError('E_USAGE', 'import requires --into <project>')

  let file = ctx.vault.getAbstractFileByPath(notePath)
  if (!(file instanceof TFile) && !notePath.endsWith('.md')) {
    file = ctx.vault.getAbstractFileByPath(`${notePath}.md`)
  }
  if (!(file instanceof TFile)) throw new PmError('E_NOT_FOUND', `No note found at "${notePath}"`)

  const projects = await ctx.store.discoverProjects()
  const located = resolveHandle(projects, projectRef)
  const project = located.project

  const handling = flagPresent(cmd.flags, 'move') ? 'move' : 'copy'
  const status = flagStr(cmd.flags, 'status') ?? 'todo'
  const priority = flagStr(cmd.flags, 'priority') ?? 'medium'

  const result = await ctx.store.importNoteAsTask(project, file, { handling, status, priority })

  const warnings =
    result === 'skipped'
      ? [{ code: 'E_CONFLICT', message: `"${file.basename}" is already a pm-task; nothing imported` }]
      : undefined
  return {
    data: { imported: result === 'imported', note: file.path, project: project.id, handling },
    changed_ids: [],
    warnings
  }
}

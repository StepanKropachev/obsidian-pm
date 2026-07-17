// Handle resolution: an agent addresses any entity by raw id, slug-path, or a
// `id:` / `path:`-prefixed form. Ambiguity is an error (never a silent pick).

import type { Project, Task } from '../../src/types'
import { findParentId, findTaskById, flattenTasks } from '../../src/store'
import { PmError } from './envelope'

export interface LocatedProject {
  kind: 'project'
  project: Project
}

export interface LocatedTask {
  kind: 'task'
  project: Project
  task: Task
  parentId: string | null
}

export type Located = LocatedProject | LocatedTask

/** The note-basename slug of a project (its filename without `.md`). */
function projectSlug(project: Project): string {
  const base = project.filePath.slice(project.filePath.lastIndexOf('/') + 1)
  return base.replace(/\.md$/, '')
}

/** The note-basename slug of a task (its filename without `.md`). */
function taskSlugOf(task: Task): string {
  if (!task.filePath) return ''
  const base = task.filePath.slice(task.filePath.lastIndexOf('/') + 1)
  return base.replace(/\.md$/, '')
}

function ci(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** Resolve a project-only handle (id | slug | title). */
export function resolveProjectRef(projects: Project[], ref: string): Project {
  const raw = ref.startsWith('id:') || ref.startsWith('path:') ? ref.slice(ref.indexOf(':') + 1) : ref
  const matches = projects.filter((p) => p.id === raw || ci(projectSlug(p), raw) || ci(p.title, raw))
  if (matches.length === 1) return matches[0]!
  if (matches.length > 1) {
    throw new PmError(
      'E_AMBIGUOUS',
      `Project handle "${ref}" matched ${matches.length} projects`,
      matches.map((p) => p.id)
    )
  }
  throw new PmError('E_NOT_FOUND', `No project matches handle "${ref}"`)
}

/** Resolve any entity handle to a project or task. */
export function resolveHandle(projects: Project[], ref: string): Located {
  const forced = ref.startsWith('id:') ? 'id' : ref.startsWith('path:') ? 'path' : 'auto'
  const raw = forced === 'auto' ? ref : ref.slice(ref.indexOf(':') + 1)

  // 1. Raw id — a project id or a task id in any project's index.
  if (forced !== 'path') {
    const proj = projects.find((p) => p.id === raw)
    if (proj) return { kind: 'project', project: proj }
    const taskMatches: LocatedTask[] = []
    for (const project of projects) {
      const task = findTaskById(project, raw)
      if (task) taskMatches.push({ kind: 'task', project, task, parentId: findParentId(project, raw) })
    }
    if (taskMatches.length === 1) return taskMatches[0]!
    if (taskMatches.length > 1) {
      throw new PmError(
        'E_AMBIGUOUS',
        `Handle "${ref}" matched ${taskMatches.length} tasks`,
        taskMatches.map((t) => t.task.id)
      )
    }
    if (forced === 'id') throw new PmError('E_NOT_FOUND', `No entity matches id "${raw}"`)
  }

  // 2. Slug-path — project-slug[/task-slug…].
  const segments = raw.split('/').filter((s) => s.length > 0)
  if (segments.length === 0) throw new PmError('E_NOT_FOUND', `Empty handle "${ref}"`)
  const projMatches = projects.filter((p) => ci(projectSlug(p), segments[0]!) || ci(p.title, segments[0]!))
  if (projMatches.length === 0) throw new PmError('E_NOT_FOUND', `No entity matches handle "${ref}"`)
  if (projMatches.length > 1) {
    throw new PmError(
      'E_AMBIGUOUS',
      `Project segment "${segments[0]}" matched ${projMatches.length} projects`,
      projMatches.map((p) => p.id)
    )
  }
  const project = projMatches[0]!
  if (segments.length === 1) return { kind: 'project', project }

  // Walk the remaining slug segments down the tree.
  const flat = flattenTasks(project.tasks)
  let current: Task | null = null
  let parentId: string | null = null
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]!
    const candidates = flat.filter(
      (f) => f.parentId === (current?.id ?? null) && (ci(taskSlugOf(f.task), seg) || ci(f.task.title, seg))
    )
    if (candidates.length === 0) throw new PmError('E_NOT_FOUND', `No entity matches handle "${ref}"`)
    if (candidates.length > 1) {
      throw new PmError(
        'E_AMBIGUOUS',
        `Segment "${seg}" matched ${candidates.length} tasks`,
        candidates.map((c) => c.task.id)
      )
    }
    parentId = candidates[0]!.parentId
    current = candidates[0]!.task
  }
  if (!current) return { kind: 'project', project }
  return { kind: 'task', project, task: current, parentId }
}

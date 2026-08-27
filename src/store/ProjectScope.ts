import type { CustomFieldDef, PriorityConfig, Project, ResolvedProjectConfig, StatusConfig, Task } from '../types'
import { findTaskById } from './TaskIndex'
import type { TaskSource } from './TaskSource'
import type { VaultIndex } from './VaultIndex'

/** What a project view renders. Carried in the view state, so a layout restores it. */
export type ScopeSpec =
  | { kind: 'project'; path: string }
  | { kind: 'subtree'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'vault' }

export function scopeKey(spec: ScopeSpec): string {
  return spec.kind === 'vault' ? 'vault' : `${spec.kind}:${spec.path}`
}

/** The project paths a spec covers, in the order the views should show them. */
export function resolveScopePaths(spec: ScopeSpec, index: VaultIndex): string[] {
  switch (spec.kind) {
    case 'project':
      return index.projectRef(spec.path) ? [spec.path] : []
    case 'subtree':
      return index.projectRef(spec.path) ? [spec.path, ...index.descendantRefs(spec.path).map((ref) => ref.path)] : []
    case 'folder': {
      const prefix = spec.path === '' ? '' : `${spec.path}/`
      return index.projectPaths().filter((path) => path.startsWith(prefix))
    }
    case 'vault':
      return index.projectPaths()
  }
}

function unionById<T extends { id: string }>(lists: T[][]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const list of lists) {
    for (const entry of list) {
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      out.push(entry)
    }
  }
  return out
}

/**
 * The set of projects one view renders. Reading goes through the scope; writing goes to
 * the project that owns the task, which `projectOf` answers. The store still knows
 * nothing about scopes: every mutation it takes is against a single project.
 */
export class ProjectScope {
  /** Resolving a config walks the project's tasks, so a row-by-row render can't repeat it. */
  private configs = new Map<string, ResolvedProjectConfig>()

  constructor(
    readonly spec: ScopeSpec,
    readonly projects: Project[],
    private store: TaskSource
  ) {}

  /** Drops the resolved configs, for when a palette changed under a live view. */
  invalidate(): void {
    this.configs.clear()
  }

  private configOfProject(project: Project): ResolvedProjectConfig {
    let config = this.configs.get(project.filePath)
    if (!config) {
      config = this.store.configFor(project)
      this.configs.set(project.filePath, config)
    }
    return config
  }

  get key(): string {
    return scopeKey(this.spec)
  }

  /** Where a new task goes, and whose settings stand in for the group's. */
  get primary(): Project | null {
    return this.projects[0] ?? null
  }

  get isMulti(): boolean {
    return this.projects.length > 1
  }

  label(): string {
    switch (this.spec.kind) {
      case 'project':
        return this.primary?.title ?? 'Project'
      case 'subtree':
        return this.primary ? `${this.primary.title} and sub-projects` : 'Project'
      case 'folder':
        return this.spec.path.slice(this.spec.path.lastIndexOf('/') + 1) || 'Vault'
      case 'vault':
        return 'All projects'
    }
  }

  /** Every project's top-level tasks, the projects kept in scope order. */
  tasks(): Task[] {
    if (!this.isMulti) return this.primary?.tasks ?? []
    return this.projects.flatMap((project) => project.tasks)
  }

  projectOf(taskId: string): Project | null {
    for (const project of this.projects) {
      if (project.taskIndex.has(taskId)) return project
    }
    return null
  }

  taskById(taskId: string): Task | null {
    const owner = this.projectOf(taskId)
    return owner ? findTaskById(owner, taskId) : null
  }

  /** Groups task ids by owning project, so a bulk action becomes one call per project. */
  groupByProject(taskIds: string[]): { project: Project; taskIds: string[] }[] {
    const groups = new Map<Project, string[]>()
    for (const id of taskIds) {
      const owner = this.projectOf(id)
      if (!owner) continue
      const bucket = groups.get(owner)
      if (bucket) bucket.push(id)
      else groups.set(owner, [id])
    }
    return [...groups].map(([project, ids]) => ({ project, taskIds: ids }))
  }

  /**
   * Display palettes only: statuses and priorities every project in scope contributes,
   * the primary project's first. Terminal-status checks must use `configOf` instead,
   * because an overridden status carries its own `complete` flag.
   */
  get config(): ResolvedProjectConfig {
    const primary = this.primary
    if (!primary) throw new Error('ProjectScope.config on an empty scope')
    const base = this.configOfProject(primary)
    if (!this.isMulti) return base
    const configs = this.projects.map((project) => this.configOfProject(project))
    return {
      ...base,
      statuses: unionById<StatusConfig>(configs.map((c) => c.statuses)),
      priorities: unionById<PriorityConfig>(configs.map((c) => c.priorities))
    }
  }

  /** The owning project's resolved config, for anything that decides a task's own state. */
  configOf(taskId: string): ResolvedProjectConfig {
    const owner = this.projectOf(taskId)
    return owner ? this.configOfProject(owner) : this.config
  }

  /**
   * Columns only, so every project in scope lines up on one header row. Editing a value
   * asks `configOf` instead, because an overridden field carries its own type and options.
   */
  customFields(): CustomFieldDef[] {
    if (!this.isMulti) return this.primary ? this.configOfProject(this.primary).customFields : []
    return unionById(this.projects.map((project) => this.configOfProject(project).customFields))
  }

  teamMembers(): string[] {
    if (!this.isMulti) return this.primary?.teamMembers ?? []
    return [...new Set(this.projects.flatMap((project) => project.teamMembers))]
  }
}

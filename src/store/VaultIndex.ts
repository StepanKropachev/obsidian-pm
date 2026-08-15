import type { App, Plugin, TAbstractFile } from 'obsidian'
import { TFile, normalizePath } from 'obsidian'
import type { PMSettings, StatusConfig } from '../types'
import { FRONTMATTER_KEY, TASK_FRONTMATTER_KEY } from './YamlParser'
import { projectPathForTaskPath } from './vaultFs'

export interface ProjectRef {
  path: string
  id: string
  title: string
  icon: string
  color: string
  /** Status ids the project's own palette marks complete. Null inherits the global palette. */
  completeStatusIds: string[] | null
}

export interface TaskRef {
  id: string
  path: string
  projectId: string
  projectPath: string | null
  title: string
  status: string
  priority: string
  start: string
  due: string
  archived: boolean
}

function str(raw: unknown, fallback = ''): string {
  return typeof raw === 'string' ? raw : fallback
}

/** A project note dropped inside a project's task storage is task storage, not a project. */
function insideTaskFolder(path: string): boolean {
  const parts = path.split('/')
  parts.pop()
  return parts.some((segment) => segment.endsWith('_tasks'))
}

function completeIdsOf(frontmatter: Record<string, unknown>): string[] | null {
  const config = frontmatter.config
  if (!config || typeof config !== 'object') return null
  const statuses = (config as Record<string, unknown>).statuses
  if (!Array.isArray(statuses) || statuses.length === 0) return null
  return (statuses as Partial<StatusConfig>[])
    .filter((entry) => entry?.complete === true && typeof entry.id === 'string')
    .map((entry) => entry.id as string)
}

/**
 * Every `pm-project` and `pm-task` note in the vault, read from the metadata cache and
 * kept current by its events. Nothing here reads a file body, so a whole-vault sweep
 * costs one pass over frontmatter Obsidian has already parsed.
 *
 * This is what makes project location irrelevant: discovery is by frontmatter, and a
 * task's owning project is resolved here rather than by pattern-matching paths at each
 * call site.
 */
export class VaultIndex {
  private projects = new Map<string, ProjectRef>()
  private projectPathById = new Map<string, string>()
  private tasks = new Map<string, TaskRef>()
  private tasksByProject = new Map<string, Set<string>>()
  private changeHandlers = new Set<() => void>()

  constructor(
    private app: App,
    private getSettings: () => PMSettings
  ) {}

  /** Call once, after the layout is ready. Safe to call again to recover from a bad state. */
  build(): void {
    this.projects.clear()
    this.projectPathById.clear()
    this.tasks.clear()
    this.tasksByProject.clear()
    for (const file of this.app.vault.getMarkdownFiles()) this.read(file)
    this.resolveUnowned()
    this.emitChange()
  }

  register(plugin: Plugin): void {
    plugin.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        this.read(file)
        this.resolveUnowned()
        this.emitChange()
      })
    )
    plugin.registerEvent(
      this.app.metadataCache.on('deleted', (file) => {
        if (this.forget(file.path)) this.emitChange()
      })
    )
    plugin.registerEvent(
      this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        const had = this.forget(oldPath)
        if (file instanceof TFile) this.read(file)
        this.resolveUnowned()
        if (had || this.tasks.has(file.path) || this.projects.has(file.path)) this.emitChange()
      })
    )
  }

  /** Returns the unsubscribe function. */
  onChange(handler: () => void): () => void {
    this.changeHandlers.add(handler)
    return () => this.changeHandlers.delete(handler)
  }

  projectRefs(): ProjectRef[] {
    return [...this.projects.values()].sort((a, b) => a.title.localeCompare(b.title))
  }

  projectRef(path: string): ProjectRef | null {
    return this.projects.get(normalizePath(path)) ?? null
  }

  projectPaths(): string[] {
    return this.projectRefs().map((ref) => ref.path)
  }

  taskRefs(projectPath: string): TaskRef[] {
    const paths = this.tasksByProject.get(normalizePath(projectPath))
    if (!paths) return []
    const refs: TaskRef[] = []
    for (const path of paths) {
      const ref = this.tasks.get(path)
      if (ref) refs.push(ref)
    }
    return refs
  }

  /** Status ids that count as finished for a project, its own palette taking precedence. */
  completeStatuses(ref: ProjectRef): Set<string> {
    return new Set(
      ref.completeStatusIds ??
        this.getSettings()
          .statuses.filter((s) => s.complete)
          .map((s) => s.id)
    )
  }

  /** Task totals for a project card, without loading the project. */
  counts(ref: ProjectRef): { total: number; done: number } {
    const complete = this.completeStatuses(ref)
    let total = 0
    let done = 0
    for (const task of this.taskRefs(ref.path)) {
      total++
      if (complete.has(task.status)) done++
    }
    return { total, done }
  }

  /** The project owning a task note, by location first and by its `projectId` when it moved. */
  projectPathForTask(taskPath: string): string | null {
    return this.tasks.get(normalizePath(taskPath))?.projectPath ?? this.resolveOwner(normalizePath(taskPath), '')
  }

  private read(file: TFile): void {
    const path = normalizePath(file.path)
    this.forget(path)
    if (this.isExcluded(path)) return
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter
    if (!frontmatter) return
    if (frontmatter[FRONTMATTER_KEY] === true && !insideTaskFolder(path)) this.addProject(path, file, frontmatter)
    else if (frontmatter[TASK_FRONTMATTER_KEY] === true) this.addTask(path, frontmatter)
  }

  private addProject(path: string, file: TFile, frontmatter: Record<string, unknown>): void {
    const ref: ProjectRef = {
      path,
      id: str(frontmatter.id, file.basename),
      title: str(frontmatter.title, file.basename),
      icon: str(frontmatter.icon, '\u{1F4CB}'),
      color: str(frontmatter.color, '#8b72be'),
      completeStatusIds: completeIdsOf(frontmatter)
    }
    this.projects.set(path, ref)
    this.projectPathById.set(ref.id, path)
  }

  private addTask(path: string, frontmatter: Record<string, unknown>): void {
    const projectId = str(frontmatter.projectId)
    const ref: TaskRef = {
      id: str(frontmatter.id, path),
      path,
      projectId,
      projectPath: this.resolveOwner(path, projectId),
      title: str(frontmatter.title, 'Untitled'),
      status: str(frontmatter.status, 'todo'),
      priority: str(frontmatter.priority, 'medium'),
      start: str(frontmatter.start),
      due: str(frontmatter.due),
      archived: path.split('/').at(-2) === 'Archive'
    }
    this.tasks.set(path, ref)
    this.own(ref)
  }

  /**
   * Location wins: a task note lives in its project's `_tasks/` folder, which resolves
   * whatever order the files are indexed in. `projectId` covers a note moved out of it.
   */
  private resolveOwner(taskPath: string, projectId: string): string | null {
    return projectPathForTaskPath(taskPath) ?? (projectId ? (this.projectPathById.get(projectId) ?? null) : null)
  }

  /** A task indexed before its project can only be placed once that project shows up. */
  private resolveUnowned(): void {
    for (const ref of this.tasks.values()) {
      if (ref.projectPath !== null) continue
      const owner = this.resolveOwner(ref.path, ref.projectId)
      if (!owner) continue
      ref.projectPath = owner
      this.own(ref)
    }
  }

  private own(ref: TaskRef): void {
    if (!ref.projectPath) return
    let bucket = this.tasksByProject.get(ref.projectPath)
    if (!bucket) {
      bucket = new Set()
      this.tasksByProject.set(ref.projectPath, bucket)
    }
    bucket.add(ref.path)
  }

  /** Drops whatever was indexed at a path. Reports whether anything was. */
  private forget(path: string): boolean {
    const normalized = normalizePath(path)
    const task = this.tasks.get(normalized)
    if (task) {
      this.tasks.delete(normalized)
      if (task.projectPath) this.tasksByProject.get(task.projectPath)?.delete(normalized)
      return true
    }
    const project = this.projects.get(normalized)
    if (project) {
      this.projects.delete(normalized)
      if (this.projectPathById.get(project.id) === normalized) this.projectPathById.delete(project.id)
      return true
    }
    return false
  }

  private isExcluded(path: string): boolean {
    return this.getSettings().excludedFolders.some((folder) => {
      const normalized = normalizePath(folder)
      return normalized !== '' && (path === normalized || path.startsWith(normalized + '/'))
    })
  }

  private emitChange(): void {
    for (const handler of this.changeHandlers) handler()
  }
}

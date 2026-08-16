import type { App, Plugin, TAbstractFile } from 'obsidian'
import { TFile, normalizePath } from 'obsidian'
import type { PMSettings, StatusConfig } from '../types'
import { today } from '../dates'
import { reaches } from './Scheduler'
import { FRONTMATTER_KEY, TASK_FRONTMATTER_KEY } from './YamlParser'
import { projectPathForTaskPath, resolveProjectLink } from './vaultFs'

export interface ProjectRef {
  path: string
  id: string
  title: string
  icon: string
  color: string
  teamMembers: string[]
  /** Where its `parent` link points, before cycles are taken out. Use `parentOf`. */
  parentPath: string | undefined
  /** Status ids the project's own palette defines. Null inherits the global palette. */
  ownStatusIds: string[] | null
  /** Which of those its own palette marks complete. Null inherits the global palette. */
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
  completed: string
  dependencies: string[]
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

function ownStatusesOf(frontmatter: Record<string, unknown>): Partial<StatusConfig>[] | null {
  const config = frontmatter.config
  if (!config || typeof config !== 'object') return null
  const statuses = (config as Record<string, unknown>).statuses
  if (!Array.isArray(statuses) || statuses.length === 0) return null
  return (statuses as Partial<StatusConfig>[]).filter((entry) => typeof entry?.id === 'string')
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
  private taskById = new Map<string, TaskRef>()
  private tasksByProject = new Map<string, Set<string>>()
  private changeHandlers = new Set<() => void>()
  private cachedTree: { parents: Map<string, string | null>; children: Map<string, string[]> } = {
    parents: new Map(),
    children: new Map()
  }
  private treeDirty = true
  /** False until the first build, so a view can tell "none yet" from "none at all". */
  ready = false

  constructor(
    private app: App,
    private getSettings: () => PMSettings
  ) {}

  /** Call once, after the layout is ready. Safe to call again to recover from a bad state. */
  build(): void {
    this.projects.clear()
    this.projectPathById.clear()
    this.tasks.clear()
    this.taskById.clear()
    this.tasksByProject.clear()
    this.treeDirty = true
    for (const file of this.app.vault.getMarkdownFiles()) this.read(file)
    this.resolveUnowned()
    this.ready = true
    this.emitChange()
  }

  register(plugin: Plugin, onFirstResolve?: () => void): void {
    // On a cold start the metadata cache is still filling when the layout is ready, so
    // the first build can see an empty vault. 'resolved' is Obsidian saying it caught up;
    // after that, 'changed' keeps the index current on its own.
    const onResolved = this.app.metadataCache.on('resolved', () => {
      this.build()
      this.app.metadataCache.offref(onResolved)
      onFirstResolve?.()
    })
    plugin.registerEvent(onResolved)

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
        // The metadata cache is not keyed by the new path yet when this fires, and a
        // renamed folder reports nothing about the notes inside it, so whatever is already
        // indexed moves by path here rather than being read back from the cache.
        if (!(file instanceof TFile)) {
          if (this.rekeyFolder(oldPath, file.path)) this.emitChange()
          return
        }
        if (this.rekeyFile(oldPath, file.path)) {
          this.resolveUnowned()
          this.emitChange()
          return
        }
        this.read(file)
        this.resolveUnowned()
        if (this.tasks.has(file.path) || this.projects.has(file.path)) this.emitChange()
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

  /** Projects with no parent, plus any whose parent link is broken or circular. */
  rootRefs(): ProjectRef[] {
    const parents = this.tree().parents
    return this.projectRefs().filter((ref) => !parents.get(ref.path))
  }

  childRefs(path: string): ProjectRef[] {
    const paths = this.tree().children.get(normalizePath(path))
    if (!paths) return []
    return paths
      .map((child) => this.projects.get(child))
      .filter((ref): ref is ProjectRef => ref !== undefined)
      .sort((a, b) => a.title.localeCompare(b.title))
  }

  /** The effective parent: a link that resolves to a live project without closing a cycle. */
  parentOf(path: string): ProjectRef | null {
    const parent = this.tree().parents.get(normalizePath(path))
    return parent ? (this.projects.get(parent) ?? null) : null
  }

  /** Every descendant, depth first. */
  descendantRefs(path: string): ProjectRef[] {
    const out: ProjectRef[] = []
    const walk = (from: string): void => {
      for (const child of this.childRefs(from)) {
        out.push(child)
        walk(child.path)
      }
    }
    walk(normalizePath(path))
    return out
  }

  /** Tasks past due and the last date anything is due, without loading the project. */
  dueSummary(ref: ProjectRef): { overdue: number; latestDue: string } {
    const complete = this.completeStatuses(ref)
    const now = today().toString()
    let overdue = 0
    let latestDue = ''
    for (const task of this.countableTasks(ref)) {
      if (!task.due) continue
      if (task.due > latestDue) latestDue = task.due
      if (task.due < now && !complete.has(task.status)) overdue++
    }
    return { overdue, latestDue }
  }

  /** The same across a project and everything under it. */
  rollupDueSummary(ref: ProjectRef): { overdue: number; latestDue: string } {
    const totals = this.dueSummary(ref)
    for (const descendant of this.descendantRefs(ref.path)) {
      const summary = this.dueSummary(descendant)
      totals.overdue += summary.overdue
      if (summary.latestDue > totals.latestDue) totals.latestDue = summary.latestDue
    }
    return totals
  }

  /** Counts for a project and everything under it, for a program or portfolio card. */
  rollupCounts(ref: ProjectRef): { total: number; done: number } {
    const totals = this.counts(ref)
    for (const descendant of this.descendantRefs(ref.path)) {
      const counts = this.counts(descendant)
      totals.total += counts.total
      totals.done += counts.done
    }
    return totals
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

  /**
   * Status ids that count as finished for a project. A project palette overrides the
   * global one entry by entry rather than wholesale, so a status it does not redefine
   * keeps the global palette's complete flag, matching what the project's views resolve.
   */
  completeStatuses(ref: ProjectRef): Set<string> {
    const global = this.getSettings()
      .statuses.filter((s) => s.complete)
      .map((s) => s.id)
    if (!ref.completeStatusIds) return new Set(global)
    const own = new Set(ref.ownStatusIds)
    return new Set([...ref.completeStatusIds, ...global.filter((id) => !own.has(id))])
  }

  /** One task per id, archived ones left out, so counts match what the project's views show. */
  private countableTasks(ref: ProjectRef): TaskRef[] {
    const seen = new Set<string>()
    const tasks: TaskRef[] = []
    for (const task of this.taskRefs(ref.path)) {
      if (task.archived || seen.has(task.id)) continue
      seen.add(task.id)
      tasks.push(task)
    }
    return tasks
  }

  /** Task totals for a project row, without loading the project. */
  counts(ref: ProjectRef): { total: number; done: number } {
    const complete = this.completeStatuses(ref)
    let total = 0
    let done = 0
    for (const task of this.countableTasks(ref)) {
      total++
      if (complete.has(task.status)) done++
    }
    return { total, done }
  }

  /**
   * A task anywhere in the vault. This is what lets a dependency point outside its own
   * project: ids are resolved here rather than inside one project's tree.
   */
  task(taskId: string): TaskRef | null {
    return this.taskById.get(taskId) ?? null
  }

  allTaskRefs(): TaskRef[] {
    return [...this.tasks.values()]
  }

  /**
   * Would making `fromId` depend on `toId` close a cycle, following dependencies wherever
   * they lead? The graph spans projects, so a cycle can too.
   */
  wouldCreateCycle(fromId: string, toId: string): boolean {
    return reaches(this.dependentsMap(), fromId, toId)
  }

  /** Tasks anywhere in the vault that list this one as a dependency. */
  dependents(taskId: string): TaskRef[] {
    return [...this.tasks.values()].filter((ref) => ref.dependencies.includes(taskId))
  }

  /** Predecessor id -> ids of everything waiting on it, across every project. */
  dependentsMap(): Map<string, string[]> {
    const map = new Map<string, string[]>()
    for (const ref of this.tasks.values()) {
      for (const depId of ref.dependencies) {
        const list = map.get(depId)
        if (list) list.push(ref.id)
        else map.set(depId, [ref.id])
      }
    }
    return map
  }

  /** The project owning a task note, by location first and by its `projectId` when it moved. */
  projectPathForTask(taskPath: string): string | null {
    return this.tasks.get(normalizePath(taskPath))?.projectPath ?? this.resolveOwner(normalizePath(taskPath), '')
  }

  private read(file: TFile): void {
    const path = normalizePath(file.path)
    const cache = this.app.metadataCache.getFileCache(file)
    // No cache entry at all means Obsidian has not caught up with this path yet, which is
    // where a rename leaves it. Keep what is indexed rather than dropping the note.
    if (!cache) return
    this.forget(path)
    if (this.isExcluded(path)) return
    const frontmatter = cache.frontmatter
    if (!frontmatter) return
    if (frontmatter[FRONTMATTER_KEY] === true && !insideTaskFolder(path)) this.addProject(path, file, frontmatter)
    else if (frontmatter[TASK_FRONTMATTER_KEY] === true) this.addTask(path, frontmatter)
  }

  private addProject(path: string, file: TFile, frontmatter: Record<string, unknown>): void {
    const own = ownStatusesOf(frontmatter)
    const ref: ProjectRef = {
      path,
      id: str(frontmatter.id, file.basename),
      title: str(frontmatter.title, file.basename),
      icon: str(frontmatter.icon, '\u{1F4CB}'),
      color: str(frontmatter.color, '#8b72be'),
      teamMembers: Array.isArray(frontmatter.teamMembers) ? (frontmatter.teamMembers as string[]) : [],
      parentPath: resolveProjectLink(this.app, frontmatter.parent, path),
      ownStatusIds: own ? own.map((entry) => entry.id as string) : null,
      completeStatusIds: own ? own.filter((entry) => entry.complete === true).map((entry) => entry.id as string) : null
    }
    this.projects.set(path, ref)
    this.projectPathById.set(ref.id, path)
    this.treeDirty = true
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
      completed: str(frontmatter.completed),
      dependencies: Array.isArray(frontmatter.dependencies) ? (frontmatter.dependencies as string[]) : [],
      archived: path.split('/').at(-2) === 'Archive'
    }
    this.tasks.set(path, ref)
    this.taskById.set(ref.id, ref)
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

  /** Moves an indexed note to its new path. False when the path held nothing indexed. */
  private rekeyFile(oldPath: string, newPath: string): boolean {
    const from = normalizePath(oldPath)
    const to = normalizePath(newPath)
    const project = this.projects.get(from)
    const task = this.tasks.get(from)
    if (!project && !task) return false
    this.forget(from)
    if (this.isExcluded(to)) return true
    if (project) {
      project.path = to
      this.projects.set(to, project)
      this.projectPathById.set(project.id, to)
      this.treeDirty = true
      this.reownTasks(from, to)
      return true
    }
    if (task) {
      task.path = to
      task.projectPath = this.resolveOwner(to, task.projectId)
      task.archived = to.split('/').at(-2) === 'Archive'
      this.tasks.set(to, task)
      this.taskById.set(task.id, task)
      this.own(task)
    }
    return true
  }

  /** Moves everything indexed under a renamed folder to its new path. */
  private rekeyFolder(oldPath: string, newPath: string): boolean {
    const from = normalizePath(oldPath) + '/'
    const to = normalizePath(newPath) + '/'
    const projects = [...this.projects.values()].filter((ref) => ref.path.startsWith(from))
    const tasks = [...this.tasks.values()].filter((ref) => ref.path.startsWith(from))
    if (!projects.length && !tasks.length) return false
    // Projects first: a task's owner is resolved from the folder it now sits in.
    for (const ref of projects) {
      this.forget(ref.path)
      ref.path = to + ref.path.slice(from.length)
      this.projects.set(ref.path, ref)
      this.projectPathById.set(ref.id, ref.path)
      this.treeDirty = true
    }
    for (const ref of tasks) {
      this.forget(ref.path)
      ref.path = to + ref.path.slice(from.length)
      ref.projectPath = this.resolveOwner(ref.path, ref.projectId)
      ref.archived = ref.path.split('/').at(-2) === 'Archive'
      this.tasks.set(ref.path, ref)
      this.taskById.set(ref.id, ref)
      this.own(ref)
    }
    return true
  }

  /**
   * Task notes keep their own paths when their project note is renamed, so ownership has
   * to follow the project rather than wait for each of them to be read again.
   */
  private reownTasks(oldProjectPath: string, newProjectPath: string): boolean {
    const from = normalizePath(oldProjectPath)
    const to = normalizePath(newProjectPath)
    const bucket = this.tasksByProject.get(from)
    if (!bucket || !this.projects.has(to)) return false
    this.tasksByProject.delete(from)
    for (const taskPath of bucket) {
      const ref = this.tasks.get(taskPath)
      if (ref) ref.projectPath = to
    }
    this.tasksByProject.set(to, bucket)
    return true
  }

  /** Drops whatever was indexed at a path. Reports whether anything was. */
  private forget(path: string): boolean {
    const normalized = normalizePath(path)
    const task = this.tasks.get(normalized)
    if (task) {
      this.tasks.delete(normalized)
      if (this.taskById.get(task.id) === task) this.taskById.delete(task.id)
      if (task.projectPath) this.tasksByProject.get(task.projectPath)?.delete(normalized)
      return true
    }
    const project = this.projects.get(normalized)
    if (project) {
      this.projects.delete(normalized)
      if (this.projectPathById.get(project.id) === normalized) this.projectPathById.delete(project.id)
      this.treeDirty = true
      return true
    }
    return false
  }

  /**
   * Parent and child edges, with cycles taken out. A project whose ancestors lead back to
   * it is treated as a root, so a bad link costs the tree one edge rather than hanging it.
   */
  private tree(): { parents: Map<string, string | null>; children: Map<string, string[]> } {
    if (!this.treeDirty) return this.cachedTree
    const parents = new Map<string, string | null>()
    for (const [path, ref] of this.projects) {
      const parent = ref.parentPath ? normalizePath(ref.parentPath) : null
      parents.set(path, parent && parent !== path && this.projects.has(parent) ? parent : null)
    }
    for (const path of parents.keys()) {
      const seen = new Set([path])
      for (let current = parents.get(path); current; current = parents.get(current)) {
        if (seen.has(current)) {
          console.error(`[PM] Circular parent link on project ${path}; treating it as a root.`)
          parents.set(path, null)
          break
        }
        seen.add(current)
      }
    }
    const children = new Map<string, string[]>()
    for (const [path, parent] of parents) {
      if (!parent) continue
      const siblings = children.get(parent)
      if (siblings) siblings.push(path)
      else children.set(parent, [path])
    }
    this.cachedTree = { parents, children }
    this.treeDirty = false
    return this.cachedTree
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

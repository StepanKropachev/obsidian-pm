import type { Plugin, TFile } from 'obsidian'
import type { Project, ProjectPatch, ResolvedProjectConfig, Task, TaskPriority, TaskStatus } from '../types'
import type { TaskFileNameConflictError } from './ProjectStore'

export interface ImportNoteOptions {
  status: TaskStatus
  priority: TaskPriority
  handling: 'move' | 'copy'
}

/**
 * The persistence surface views, modals, and commands program against (`plugin.store`).
 * ProjectStore implements it over pm-task markdown files; other backends can too.
 */
export interface TaskSource {
  registerVaultSync(plugin: Plugin): void

  /**
   * How views learn they need to re-render, whoever caused the change. Returns the
   * unsubscribe function.
   */
  onProjectChanged(handler: (path: string) => void): () => void

  ensureFolder(folderPath: string): Promise<void>

  /**
   * The project's overrides applied over the source's defaults. Views and modals must
   * read palettes through this, never from the global settings.
   */
  configFor(project: Project): ResolvedProjectConfig

  /** Loads the projects at the given paths, skipping any that no longer resolve to a file. */
  loadProjects(paths: string[]): Promise<Project[]>

  /** Every caller gets the same instance for a path, for as long as the project exists. */
  loadProject(file: TFile): Promise<Project | null>
  /** Null when the path names no file, so callers holding a path don't resolve it themselves. */
  loadProjectByPath(path: string): Promise<Project | null>
  loadTaskBody(task: Task): Promise<void>
  loadProjectBody(project: Project): Promise<void>

  createProject(title: string, folder: string, patch?: ProjectPatch): Promise<Project>
  /**
   * Moves a project that still sits beside its `<name>_tasks` folder into a folder of its
   * own. Returns the note's new path, or null when the project already owns a folder.
   */
  moveProjectIntoOwnFolder(projectPath: string): Promise<string | null>
  /** Writes a sub-project's `parent` link again, for when the parent note moved. */
  repointProjectParent(childPath: string, parentPath: string): Promise<void>
  saveProject(project: Project): Promise<void>
  updateProject(project: Project, patch: ProjectPatch): Promise<void>
  deleteProject(project: Project): Promise<void>

  insertTask(project: Project, task: Task, parentId?: string | null): Promise<void>
  duplicateTask(project: Project, sourceId: string, includeSubtasks: boolean): Promise<Task | null>
  /**
   * Gives the listed tasks fresh ids, remapping every reference the project holds to
   * them, and optionally the project's own id. Repairs a project whose folder was
   * copied on disk, which duplicates every id in it.
   */
  reassignIds(project: Project, taskIds: string[], newProjectId: boolean): Promise<void>
  importNoteAsTask(project: Project, file: TFile, opts: ImportNoteOptions): Promise<'imported' | 'skipped'>
  importTaskForest(
    project: Project,
    roots: Task[],
    sources: Map<string, TFile>,
    handling: 'move' | 'copy'
  ): Promise<number>
  updateTask(project: Project, taskId: string, patch: Partial<Task>): Promise<void>
  updateTasks(
    project: Project,
    taskIds: string[],
    patch: Partial<Task> | ((task: Task) => Partial<Task> | null)
  ): Promise<void>
  moveTask(project: Project, taskId: string, newParentId: string | null): Promise<void>
  /** Moves a task and its subtasks to another project, keeping their ids. */
  moveTaskToProject(from: Project, to: Project, taskId: string, newParentId?: string | null): Promise<void>
  moveTasks(project: Project, taskIds: string[], newParentId: string | null): Promise<void>
  reorderTask(project: Project, taskId: string, targetId: string, position: 'before' | 'after'): Promise<void>
  deleteTask(project: Project, taskId: string): Promise<void>
  deleteTasks(project: Project, taskIds: string[]): Promise<void>
  archiveTask(project: Project, taskId: string): Promise<void>
  archiveTasks(project: Project, taskIds: string[]): Promise<void>
  unarchiveTask(project: Project, taskId: string): Promise<void>

  /** Runs dependency-based auto-scheduling; a no-op when the project's config disables it. */
  scheduleAfterChange(project: Project, changedTaskId?: string): Promise<number>
  saveTaskAttachment(project: Project, task: Task, fileName: string, data: ArrayBuffer): Promise<TFile>
  findTaskFileConflict(project: Project, task: Task): TaskFileNameConflictError | null
}

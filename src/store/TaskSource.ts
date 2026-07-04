import type { Plugin, TFile } from 'obsidian'
import type { Project, ResolvedProjectConfig, Task, TaskPriority, TaskStatus } from '../types'
import type { TaskFileNameConflictError } from './ProjectStore'

export interface ImportNoteOptions {
  status: TaskStatus
  priority: TaskPriority
  handling: 'move' | 'copy'
}

/**
 * The task persistence surface views, modals, and commands program against
 * (`plugin.store`). ProjectStore is the default implementation over pm-task
 * markdown files; alternative backends (e.g. TaskNotes-managed notes) implement
 * the same contract.
 */
export interface TaskSource {
  registerCacheInvalidation(plugin: Plugin): void
  consumeSelfWrite(path: string): boolean
  ensureFolder(folderPath: string): Promise<void>

  /**
   * The configuration in effect for a project (statuses, priorities, view and
   * scheduling behavior), with the project's overrides applied over the
   * source's defaults. Views and modals must read palettes through this
   * instead of the global settings.
   */
  configFor(project: Project): ResolvedProjectConfig

  loadAllProjects(folder: string): Promise<Project[]>
  loadProject(file: TFile): Promise<Project | null>
  loadTaskBody(task: Task): Promise<void>
  loadProjectBody(project: Project): Promise<void>

  createProject(title: string, folder: string): Promise<Project>
  saveProject(project: Project): Promise<void>
  deleteProject(project: Project): Promise<void>

  insertTask(project: Project, task: Task, parentId?: string | null): Promise<void>
  duplicateTask(project: Project, sourceId: string, includeSubtasks: boolean): Promise<Task | null>
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
  moveTasks(project: Project, taskIds: string[], newParentId: string | null): Promise<void>
  reorderTask(project: Project, taskId: string, targetId: string, position: 'before' | 'after'): Promise<void>
  deleteTask(project: Project, taskId: string): Promise<void>
  deleteTasks(project: Project, taskIds: string[]): Promise<void>
  archiveTask(project: Project, taskId: string): Promise<void>
  unarchiveTask(project: Project, taskId: string): Promise<void>

  /** Runs dependency-based auto-scheduling; a no-op when the project's config disables it. */
  scheduleAfterChange(project: Project, changedTaskId?: string): Promise<number>
  saveTaskAttachment(project: Project, task: Task, fileName: string, data: ArrayBuffer): Promise<TFile>
  findTaskFileConflict(project: Project, task: Task): TaskFileNameConflictError | null
}

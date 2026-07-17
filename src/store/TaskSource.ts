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
  /** Find every `pm-project: true` file anywhere in the vault (not just a configured root). */
  discoverProjects(): Promise<Project[]>
  /** The vault-relative directory a project lives in: its `path` frontmatter, else the file's parent folder. */
  projectDirectory(project: Project): string
  /**
   * Should the project dashboard refresh for this path? True vault-wide for a
   * `pm-project: true` file (via metadataCache) anywhere, or a markdown file under
   * a known project's directory / `<Name>_tasks` folder; false for unrelated notes.
   */
  isProjectRelevantPath(path: string): boolean
  loadProject(file: TFile): Promise<Project | null>
  loadTaskBody(task: Task): Promise<void>
  loadProjectBody(project: Project): Promise<void>

  /**
   * True iff a note holds real body content beyond its frontmatter and any
   * store-managed backlink line(s) (`<!-- pm:link -->`); the signal behind the
   * CLI `✎` symbol. A note that is only its managed backlink reads as empty.
   */
  hasBodyContent(file: TFile): Promise<boolean>
  /**
   * Count of non-blank body lines that survive stripping the frontmatter and any
   * managed backlink line(s) — the CLI `✎N` size hint.
   */
  bodyContentLines(file: TFile): Promise<number>

  createProject(title: string, folder: string): Promise<Project>
  saveProject(project: Project): Promise<void>
  deleteProject(project: Project): Promise<void>

  insertTask(project: Project, task: Task, parentId?: string | null): Promise<void>
  /**
   * Ingest an externally-authored `pm-task` file that appeared under a project's
   * tasks folder: backfill a missing id and required frontmatter onto disk,
   * resolve blank fields to defaults, and wire it into the project's ordering.
   * Returns null (without throwing) for a non-pm-task / malformed / out-of-folder file.
   */
  ingestExternalTask(project: Project, file: TFile): Promise<Task | null>
  /**
   * Route a vault create/modify of a possibly-external pm-task file to ingestion,
   * skipping the store's own writes. Returns the ingested task, or null when the
   * file is a self-write, a non-task, or outside every loaded project's folder.
   */
  handleExternalTaskChange(file: TFile): Promise<Task | null>
  /**
   * Rename a loaded project via the plugin: rename its `.md` file and `<Name>_tasks`
   * folder on disk, keep tasks attached, and persist the new title. Self-marks the
   * paths so the resulting vault rename events do not echo back.
   */
  renameProject(project: Project, newTitle: string): Promise<void>
  /**
   * Re-point an already-created project's directory: move its `.md` file and
   * `<Name>_tasks` folder (attachments + Archive included) under `newDir`, update the
   * `path` frontmatter + resolved directory, and keep tasks attached. Self-marks the
   * touched paths so the resulting vault rename events do not echo. No-op when `newDir`
   * already is the project's directory; throws if the destination `.md` exists.
   */
  moveProject(project: Project, newDir: string): Promise<void>
  /**
   * Migrate legacy flat-layout projects (`<dir>/<Name>.md` + sibling
   * `<dir>/<Name>_tasks/`) into the nested per-project-folder layout
   * (`<dir>/<Name>/…`) via vault rename, preserving the note body + task
   * association. Idempotent (a no-op when already nested) and re-runnable; runs
   * automatically on load via `discoverProjects`. With `{ dryRun: true }` it
   * performs no writes and returns the `{ from, to }` moves that WOULD happen.
   */
  migrateLegacyProjects(options?: { dryRun?: boolean }): Promise<Array<{ from: string; to: string }>>
  /**
   * Map an inbound vault rename (old path → renamed file) onto the loaded item and
   * update its name in memory + persisted title; cascades a project's `<Name>_tasks`
   * folder so tasks stay attached. A no-op when the old path resolves to no loaded item.
   */
  handleExternalRename(oldPath: string, file: TFile): Promise<void>
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

  /**
   * Run `fn` as one batch against `project` with per-mutator disk saves
   * SUPPRESSED: mutations still update the in-memory tree and accumulate dirty
   * state, but nothing is written until `fn` settles. On success exactly one
   * `saveProject` + one `scheduleAfterChange` run for the project; on a throw the
   * in-memory `project.tasks` is rolled back to its pre-transaction snapshot and
   * NOTHING is written (all-or-nothing). Nesting on the same project is flat — an
   * inner `transact` just runs `fn` inline, with the outermost owning the save.
   */
  transact<T>(project: Project, fn: () => Promise<T> | T): Promise<T>

  /**
   * Shift a task's own `start`/`due` by `deltaDays` (empty dates stay empty).
   * With `cascadeSubtree` (default true) every DESCENDANT's `start`/`due` shifts
   * by the same delta, so a moved parent drags its subtree along; with it off
   * only the one task moves. Composes with scheduling: after applying the shift
   * it runs `scheduleAfterChange`, so downstream DEPENDENTS still cascade.
   * Returns the count of tasks whose dates were shifted.
   */
  shiftTaskDates(
    project: Project,
    taskId: string,
    deltaDays: number,
    opts?: { cascadeSubtree?: boolean; scheduleDownstream?: boolean }
  ): Promise<number>
  saveTaskAttachment(project: Project, task: Task, fileName: string, data: ArrayBuffer): Promise<TFile>
  findTaskFileConflict(project: Project, task: Task): TaskFileNameConflictError | null
}

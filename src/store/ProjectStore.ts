import { App, Notice, TFile, TFolder, normalizePath } from 'obsidian';
import type { Project, Task } from '../types';
import { makeProject, makeTask } from '../types';
import {
  updateTaskInTree,
  deleteTaskFromTree,
  addTaskToTree,
  findTask,
} from './TaskTreeOps';
import { computeSchedule } from './Scheduler';
import { archiveTask as doArchiveTask, unarchiveTask as doUnarchiveTask } from './ArchiveOps';
import { parseFrontmatter, FRONTMATTER_KEY, TASK_FRONTMATTER_KEY } from './YamlParser';
import { hydrateProjectFromFrontmatter, hydrateTaskFromFile, hydrateTasks } from './YamlHydrator';
import { serializeProject, serializeTask, taskFilePath } from './YamlSerializer';

/**
 * Handles all read/write operations against the Obsidian vault.
 *
 * Storage layout:
 *   Projects/<ProjectName>.md         — project metadata (no task data)
 *   Projects/<ProjectName>/<slug>.md  — one .md per task
 *
 * The in-memory Project.tasks tree is assembled on load from individual
 * task files and remains unchanged for views.
 */
export class ProjectStore {
  /** Per-project promise chains to serialize concurrent saves */
  private saveQueues = new Map<string, Promise<void>>();

  constructor(private app: App) {}

  // ─── Folder helpers ────────────────────────────────────────────────────────

  async ensureFolder(folderPath: string): Promise<void> {
    const normalized = normalizePath(folderPath);
    if (!(this.app.vault.getAbstractFileByPath(normalized) instanceof TFolder)) {
      await this.app.vault.createFolder(normalized);
    }
  }

  /** Get the task subfolder path for a project */
  private projectTaskFolder(project: Project): string {
    return project.filePath.replace(/\.md$/, '_tasks');
  }

  // ─── Load ──────────────────────────────────────────────────────────────────

  async loadAllProjects(folder: string): Promise<Project[]> {
    await this.ensureFolder(folder);
    const projects: Project[] = [];
    const files = this.app.vault.getMarkdownFiles().filter(f =>
      f.path.startsWith(folder + '/') && !this.isTaskFile(f),
    );
    for (const file of files) {
      const project = await this.loadProject(file);
      if (project) projects.push(project);
    }
    return projects.sort((a, b) => a.title.localeCompare(b.title));
  }

  private isTaskFile(file: TFile): boolean {
    return /_tasks\//.test(file.path);
  }

  async loadProject(file: TFile): Promise<Project | null> {
    try {
      const content = await this.app.vault.read(file);
      const { frontmatter, body } = parseFrontmatter(content);
      if (!frontmatter || frontmatter[FRONTMATTER_KEY] !== true) return null;

      const hasEmbeddedTasks = Array.isArray(frontmatter.tasks) && frontmatter.tasks.length > 0;

      const project = hydrateProjectFromFrontmatter(frontmatter, body, file.path, file.basename);

      if (hasEmbeddedTasks) {
        project.tasks = hydrateTasks((frontmatter.tasks as unknown[]) ?? []);
      } else {
        const taskFolder = this.projectTaskFolder(project);
        const taskIds = Array.isArray(frontmatter.taskIds) ? frontmatter.taskIds as string[] : [];
        project.tasks = await this.loadTasksFromFolder(taskFolder, taskIds);
      }

      return project;
    } catch (e) {
      console.error(`[PM] Failed to load project ${file.path}:`, e);
      new Notice(`Project Manager: Failed to load "${file.basename}". Check console for details.`);
      return null;
    }
  }

  private async loadTasksFromFolder(folderPath: string, topLevelIds: string[]): Promise<Task[]> {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) return [];

    const taskMap = new Map<string, Task>();
    const subtaskIdsMap = new Map<string, string[]>();
    const archivePrefix = normalizePath(folderPath + '/Archive') + '/';

    const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folderPath + '/'));
    for (const file of files) {
      const { task, subtaskIds } = await this.loadTaskFile(file);
      if (task) {
        if (file.path.startsWith(archivePrefix)) {
          task.archived = true;
        }
        taskMap.set(task.id, task);
        if (subtaskIds.length) subtaskIdsMap.set(task.id, subtaskIds);
      }
    }

    for (const [taskId, sids] of subtaskIdsMap) {
      const task = taskMap.get(taskId);
      if (!task) continue;
      task.subtasks = [];
      for (const sid of sids) {
        const sub = taskMap.get(sid);
        if (sub) task.subtasks.push(sub);
      }
    }

    const result: Task[] = [];
    for (const id of topLevelIds) {
      const task = taskMap.get(id);
      if (task) result.push(task);
    }
    for (const task of taskMap.values()) {
      if (!topLevelIds.includes(task.id)) {
        const isChild = [...taskMap.values()].some(t =>
          t.subtasks.some(s => s.id === task.id),
        );
        if (!isChild) result.push(task);
      }
    }

    return result;
  }

  async loadTaskFile(file: TFile): Promise<{ task: Task | null; subtaskIds: string[] }> {
    try {
      const content = await this.app.vault.read(file);
      const { frontmatter, body } = parseFrontmatter(content);
      if (!frontmatter || frontmatter[TASK_FRONTMATTER_KEY] !== true) return { task: null, subtaskIds: [] };

      return hydrateTaskFromFile(frontmatter, body, file.path);
    } catch (e) {
      if (e instanceof Error && e.message.includes('ENOENT')) {
        console.warn(`[PM] Task file no longer exists, skipping: ${file.path}`);
      } else {
        console.error(`[PM] Failed to load task ${file.path}:`, e);
        new Notice(`Project Manager: Failed to load task "${file.basename}". Check console for details.`);
      }
      return { task: null, subtaskIds: [] };
    }
  }

  // ─── Save ──────────────────────────────────────────────────────────────────

  async saveProject(project: Project): Promise<void> {
    const key = project.filePath;
    const prev = this.saveQueues.get(key) ?? Promise.resolve();
    const next = prev.then(() => this.doSaveProject(project));
    this.saveQueues.set(key, next.catch(() => {}));
    return next;
  }

  private async doSaveProject(project: Project): Promise<void> {
    try {
      project.updatedAt = new Date().toISOString();

      const taskFolder = this.projectTaskFolder(project);
      await this.ensureFolder(taskFolder);

      await this.saveAllTasks(project.tasks, project, null, taskFolder);

      const content = serializeProject(project);
      const file = this.app.vault.getAbstractFileByPath(project.filePath);
      if (file instanceof TFile) {
        await this.app.vault.modify(file, content);
      } else {
        await this.app.vault.create(project.filePath, content);
      }
    } catch (e) {
      console.error(`[PM] Failed to save project "${project.title}":`, e);
      new Notice(`Project Manager: Failed to save "${project.title}". Check console for details.`);
      throw e;
    }
  }

  private async saveAllTasks(tasks: Task[], project: Project, parentTask: Task | null, folder: string): Promise<void> {
    const errors: Error[] = [];
    for (const task of tasks) {
      try {
        let targetFolder = folder;
        if (task.archived) {
          targetFolder = normalizePath(folder + '/Archive');
          await this.ensureFolder(targetFolder);
        }
        await this.saveTaskFile(task, project, parentTask, targetFolder);
        if (task.subtasks.length) {
          await this.saveAllTasks(task.subtasks, project, task, folder);
        }
      } catch (e) {
        errors.push(e instanceof Error ? e : new Error(String(e)));
      }
    }
    if (errors.length) {
      throw new Error(`Failed to save ${errors.length} task(s): ${errors.map(e => e.message).join('; ')}`);
    }
  }

  private async saveTaskFile(task: Task, project: Project, parentTask: Task | null, folder: string): Promise<void> {
    const filePath = normalizePath(taskFilePath(task.title, task.id, folder));
    const oldFilePath = task.filePath && task.filePath !== filePath ? task.filePath : null;
    task.filePath = filePath;

    try {
      // Write new file first, then delete old — prevents data loss if interrupted
      const content = serializeTask(task, project, parentTask);
      const existing = this.app.vault.getAbstractFileByPath(filePath);
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, content);
      } else {
        await this.app.vault.create(filePath, content);
      }

      if (oldFilePath) {
        const oldFile = this.app.vault.getAbstractFileByPath(oldFilePath);
        if (oldFile instanceof TFile) {
          await this.app.fileManager.trashFile(oldFile);
        }
      }
    } catch (e) {
      console.error(`[PM] Failed to save task "${task.title}" (${task.id}):`, e);
      throw e;
    }
  }

  // ─── CRUD shortcuts ────────────────────────────────────────────────────────

  async createProject(title: string, folder: string): Promise<Project> {
    const safeName = title.replace(/[\\/:*?"<>|]/g, '-');
    const filePath = normalizePath(`${folder}/${safeName}.md`);
    const project = makeProject(title, filePath);
    await this.ensureFolder(this.projectTaskFolder(project));
    await this.saveProject(project);
    return project;
  }

  async addTask(project: Project, parentId: string | null = null): Promise<Task> {
    const task = makeTask();
    addTaskToTree(project.tasks, task, parentId);
    await this.saveProject(project);
    return task;
  }

  async insertTask(project: Project, task: Task, parentId: string | null = null): Promise<void> {
    addTaskToTree(project.tasks, task, parentId);
    await this.saveProject(project);
  }

  async moveTask(project: Project, taskId: string, newParentId: string | null): Promise<void> {
    const task = findTask(project.tasks, taskId);
    if (!task) return;
    deleteTaskFromTree(project.tasks, taskId);
    addTaskToTree(project.tasks, task, newParentId);
    await this.saveProject(project);
  }

  async updateTask(project: Project, taskId: string, patch: Partial<Task>): Promise<void> {
    updateTaskInTree(project.tasks, taskId, patch);
    await this.saveProject(project);
  }

  async updateTasks(project: Project, taskIds: string[], patch: Partial<Task>): Promise<void> {
    for (const id of taskIds) {
      updateTaskInTree(project.tasks, id, patch);
    }
    await this.saveProject(project);
  }

  async deleteTasks(project: Project, taskIds: string[]): Promise<void> {
    const folder = this.projectTaskFolder(project);
    for (const id of taskIds) {
      const task = findTask(project.tasks, id);
      if (task) await this.deleteTaskFiles(task, folder);
      deleteTaskFromTree(project.tasks, id);
    }
    await this.saveProject(project);
  }

  async archiveTask(project: Project, taskId: string): Promise<void> {
    await doArchiveTask(this.app, project, taskId);
  }

  async unarchiveTask(project: Project, taskId: string): Promise<void> {
    await doUnarchiveTask(this.app, project, taskId);
  }

  async deleteTask(project: Project, taskId: string): Promise<void> {
    const task = findTask(project.tasks, taskId);
    if (task) {
      await this.deleteTaskFiles(task, this.projectTaskFolder(project));
    }
    deleteTaskFromTree(project.tasks, taskId);
    await this.saveProject(project);
  }

  private async deleteTaskFiles(task: Task, folder: string): Promise<void> {
    for (const sub of task.subtasks) {
      await this.deleteTaskFiles(sub, folder);
    }
    if (task.filePath) {
      const file = this.app.vault.getAbstractFileByPath(task.filePath);
      if (file instanceof TFile) await this.app.fileManager.trashFile(file);
    }
  }

  async deleteProject(project: Project): Promise<void> {
    const taskFolder = this.projectTaskFolder(project);
    const folder = this.app.vault.getAbstractFileByPath(taskFolder);
    if (folder instanceof TFolder) {
      await this.deleteFolderRecursive(folder);
    }
    const file = this.app.vault.getAbstractFileByPath(project.filePath);
    if (file instanceof TFile) await this.app.fileManager.trashFile(file);
  }

  private async deleteFolderRecursive(folder: TFolder): Promise<void> {
    for (const child of [...folder.children]) {
      if (child instanceof TFile) {
        await this.app.fileManager.trashFile(child);
      } else if (child instanceof TFolder) {
        await this.deleteFolderRecursive(child);
      }
    }
    await this.app.fileManager.trashFile(folder);
  }

  // ─── Scheduling ──────────────────────────────────────────────────────────

  /**
   * Run dependency-based scheduling on the project.
   * Applies computed date patches and saves.
   * Returns the number of tasks that were adjusted.
   */
  async scheduleAfterChange(project: Project, changedTaskId?: string): Promise<number> {
    const { patches } = computeSchedule(project.tasks, changedTaskId);
    if (patches.length === 0) return 0;

    for (const p of patches) {
      updateTaskInTree(project.tasks, p.taskId, { start: p.start, due: p.due });
    }
    await this.saveProject(project);
    return patches.length;
  }

}

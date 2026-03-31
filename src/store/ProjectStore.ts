import { App, Notice, TFile, TFolder, normalizePath } from 'obsidian';
import type { Project, Task } from '../types';
import { makeProject, makeTask } from '../types';
import {
  updateTaskInTree,
  deleteTaskFromTree,
  addTaskToTree,
  findTask,
} from './TaskTreeOps';
import {
  parseFrontmatter,
  hydrateProjectFromFrontmatter,
  hydrateTaskFromFile,
  hydrateTasks,
  serializeProject,
  serializeTask,
  taskFilePath,
  isOldFormat,
  FRONTMATTER_KEY,
  TASK_FRONTMATTER_KEY,
} from './YamlSerializer';

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
    const parts = file.path.split('/');
    return parts.length >= 3 && !file.path.endsWith('.md.md');
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

    const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folderPath + '/'));
    for (const file of files) {
      const { task, subtaskIds } = await this.loadTaskFile(file);
      if (task) {
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
      console.error(`[PM] Failed to load task ${file.path}:`, e);
      new Notice(`Project Manager: Failed to load task "${file.basename}". Check console for details.`);
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
  }

  private async saveAllTasks(tasks: Task[], project: Project, parentTask: Task | null, folder: string): Promise<void> {
    for (const task of tasks) {
      await this.saveTaskFile(task, project, parentTask, folder);
      if (task.subtasks.length) {
        await this.saveAllTasks(task.subtasks, project, task, folder);
      }
    }
  }

  private async saveTaskFile(task: Task, project: Project, parentTask: Task | null, folder: string): Promise<void> {
    const filePath = normalizePath(taskFilePath(task.title, task.id, folder));
    const oldFilePath = task.filePath && task.filePath !== filePath ? task.filePath : null;
    task.filePath = filePath;

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
        await this.app.vault.delete(oldFile);
      }
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
      if (file instanceof TFile) await this.app.vault.delete(file);
    }
  }

  async deleteProject(project: Project): Promise<void> {
    const taskFolder = this.projectTaskFolder(project);
    const folder = this.app.vault.getAbstractFileByPath(taskFolder);
    if (folder instanceof TFolder) {
      for (const child of folder.children) {
        if (child instanceof TFile) await this.app.vault.delete(child);
      }
      await this.app.vault.delete(folder);
    }
    const file = this.app.vault.getAbstractFileByPath(project.filePath);
    if (file instanceof TFile) await this.app.vault.trash(file, true);
  }

  // ─── Migration helpers (public for migration.ts) ──────────────────────────

  parseFrontmatter(content: string) {
    return parseFrontmatter(content);
  }

  isOldFormat(frontmatter: Record<string, unknown>): boolean {
    return isOldFormat(frontmatter);
  }

  hydrateTasksFromOldFormat(raw: unknown[]): Task[] {
    return hydrateTasks(raw);
  }
}

import { App, TFile, TFolder, normalizePath } from 'obsidian';
import {
  Project,
  Task,
  CustomFieldDef,
  SavedView,
  makeProject,
  makeTask,
  updateTaskInTree,
  deleteTaskFromTree,
  addTaskToTree,
  findTask,
  flattenTasks,
} from './types';
import { sanitizeFileName } from './utils';

const FRONTMATTER_KEY = 'pm-project';
const TASK_FRONTMATTER_KEY = 'pm-task';

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
    // e.g. "Projects/MyProject.md" → "Projects/MyProject_tasks"
    // Use _tasks suffix to avoid conflict with the .md file
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

  /** Check if a file path looks like it's inside a project subfolder (task file) */
  private isTaskFile(file: TFile): boolean {
    // Task files are in a subfolder matching a project name.
    // We check by path depth: Projects/Foo.md = project, Projects/Foo/bar.md = task
    const parts = file.path.split('/');
    return parts.length >= 3 && !file.path.endsWith('.md.md');
  }

  async loadProject(file: TFile): Promise<Project | null> {
    try {
      const content = await this.app.vault.read(file);
      const { frontmatter, body } = this.parseFrontmatter(content);
      if (!frontmatter || frontmatter[FRONTMATTER_KEY] !== true) return null;

      // Check if this is old format (tasks embedded in frontmatter)
      const hasEmbeddedTasks = Array.isArray(frontmatter.tasks) && frontmatter.tasks.length > 0;

      const project: Project = {
        id: (frontmatter.id as string) ?? file.basename,
        title: (frontmatter.title as string) ?? file.basename,
        description: (frontmatter.description as string) ?? body.trim(),
        color: (frontmatter.color as string) ?? '#6366f1',
        icon: (frontmatter.icon as string) ?? '📋',
        tasks: [],
        customFields: (frontmatter.customFields as CustomFieldDef[]) ?? [],
        teamMembers: (frontmatter.teamMembers as string[]) ?? [],
        createdAt: (frontmatter.createdAt as string) ?? new Date().toISOString(),
        updatedAt: (frontmatter.updatedAt as string) ?? new Date().toISOString(),
        filePath: file.path,
        savedViews: this.hydrateSavedViews((frontmatter.savedViews as unknown[]) ?? []),
      };

      if (hasEmbeddedTasks) {
        // Old format: load tasks from embedded YAML
        project.tasks = this.hydrateTasks((frontmatter.tasks as unknown[]) ?? []);
      } else {
        // New format: load tasks from individual .md files in project subfolder
        const taskFolder = this.projectTaskFolder(project);
        const taskIds = Array.isArray(frontmatter.taskIds) ? frontmatter.taskIds as string[] : [];
        project.tasks = await this.loadTasksFromFolder(taskFolder, taskIds);
      }

      return project;
    } catch {
      return null;
    }
  }

  /** Load all task .md files from a folder and rebuild the tree */
  private async loadTasksFromFolder(folderPath: string, topLevelIds: string[]): Promise<Task[]> {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) return [];

    // Load all task files
    const taskMap = new Map<string, Task>();
    const subtaskIdsMap = new Map<string, string[]>(); // taskId -> subtaskIds

    const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folderPath + '/'));
    for (const file of files) {
      const { task, subtaskIds } = await this.loadTaskFile(file);
      if (task) {
        taskMap.set(task.id, task);
        if (subtaskIds.length) subtaskIdsMap.set(task.id, subtaskIds);
      }
    }

    // Build tree from subtaskIds references
    for (const [taskId, sids] of subtaskIdsMap) {
      const task = taskMap.get(taskId);
      if (!task) continue;
      task.subtasks = [];
      for (const sid of sids) {
        const sub = taskMap.get(sid);
        if (sub) task.subtasks.push(sub);
      }
    }

    // Return top-level tasks in order
    const result: Task[] = [];
    for (const id of topLevelIds) {
      const task = taskMap.get(id);
      if (task) result.push(task);
    }
    // Also include any tasks not in topLevelIds (orphans)
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

  /** Strip auto-generated wiki-link lines from task body so they don't get duplicated on save */
  private stripAutoGeneratedContent(body: string): string {
    let result = body;
    // Remove Project/Parent wiki-link lines
    result = result.replace(/^Project: \[\[.*\]\]$/gm, '');
    result = result.replace(/^Parent: \[\[.*\]\]$/gm, '');
    // Remove ## Subtasks section and everything after
    result = result.replace(/\n## Subtasks[\s\S]*$/, '');
    return result.trim();
  }

  /** Load a single task from its .md file */
  async loadTaskFile(file: TFile): Promise<{ task: Task | null; subtaskIds: string[] }> {
    try {
      const content = await this.app.vault.read(file);
      const { frontmatter, body } = this.parseFrontmatter(content);
      if (!frontmatter || frontmatter[TASK_FRONTMATTER_KEY] !== true) return { task: null, subtaskIds: [] };

      const task = makeTask({
        id: frontmatter.id as string,
        title: (frontmatter.title as string) ?? 'Untitled',
        description: this.stripAutoGeneratedContent(body),
        type: (frontmatter.type as string) === 'milestone' ? 'milestone'
            : (frontmatter.type as string) === 'subtask' ? 'subtask' as Task['type']
            : 'task',
        status: (frontmatter.status as Task['status']) ?? 'todo',
        priority: (frontmatter.priority as Task['priority']) ?? 'medium',
        start: (frontmatter.start as string) ?? '',
        due: (frontmatter.due as string) ?? '',
        progress: typeof frontmatter.progress === 'number' ? frontmatter.progress : 0,
        assignees: Array.isArray(frontmatter.assignees) ? frontmatter.assignees : [],
        tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
        subtasks: [], // rebuilt after all files loaded
        dependencies: Array.isArray(frontmatter.dependencies) ? frontmatter.dependencies : [],
        recurrence: frontmatter.recurrence && typeof frontmatter.recurrence === 'object'
          ? frontmatter.recurrence as Task['recurrence']
          : undefined,
        timeEstimate: typeof frontmatter.timeEstimate === 'number' ? frontmatter.timeEstimate : undefined,
        timeLogs: Array.isArray(frontmatter.timeLogs)
          ? (frontmatter.timeLogs as { date: string; hours: number; note: string }[])
          : undefined,
        customFields: typeof frontmatter.customFields === 'object' && frontmatter.customFields !== null
          ? frontmatter.customFields as Record<string, unknown>
          : {},
        collapsed: frontmatter.collapsed === true,
        createdAt: (frontmatter.createdAt as string) ?? new Date().toISOString(),
        updatedAt: (frontmatter.updatedAt as string) ?? new Date().toISOString(),
        filePath: file.path,
      });

      const subtaskIds = Array.isArray(frontmatter.subtaskIds) ? frontmatter.subtaskIds as string[] : [];
      return { task, subtaskIds };
    } catch {
      return { task: null, subtaskIds: [] };
    }
  }

  private hydrateSavedViews(raw: unknown[]): SavedView[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(r => r && typeof r === 'object').map(r => {
      const v = r as Record<string, unknown>;
      const filter = (v.filter ?? {}) as Record<string, unknown>;
      return {
        id: (v.id as string) ?? '',
        name: (v.name as string) ?? 'Untitled',
        filter: {
          text: (filter.text as string) ?? '',
          statuses: Array.isArray(filter.statuses) ? filter.statuses : [],
          priorities: Array.isArray(filter.priorities) ? filter.priorities : [],
          assignees: Array.isArray(filter.assignees) ? filter.assignees : [],
          tags: Array.isArray(filter.tags) ? filter.tags : [],
          dueDateFilter: (filter.dueDateFilter as string as SavedView['filter']['dueDateFilter']) ?? 'any',
        },
        sortKey: (v.sortKey as string) ?? 'status',
        sortDir: (v.sortDir as 'asc' | 'desc') ?? 'asc',
      };
    });
  }

  // Keep for migration compatibility
  private hydrateTasks(raw: unknown[]): Task[] {
    if (!Array.isArray(raw)) return [];
    return raw.map(r => this.hydrateTask(r as Record<string, unknown>));
  }

  private hydrateTask(r: Record<string, unknown>): Task {
    return makeTask({
      id: r.id as string,
      title: r.title as string ?? 'Untitled',
      description: r.description as string ?? '',
      type: (r.type as string) === 'milestone' ? 'milestone' : (r.type as string) === 'subtask' ? 'subtask' : 'task',
      status: r.status as Task['status'] ?? 'todo',
      priority: r.priority as Task['priority'] ?? 'medium',
      start: r.start as string ?? '',
      due: r.due as string ?? '',
      progress: typeof r.progress === 'number' ? r.progress : 0,
      assignees: Array.isArray(r.assignees) ? r.assignees : [],
      tags: Array.isArray(r.tags) ? r.tags : [],
      subtasks: Array.isArray(r.subtasks) ? this.hydrateTasks(r.subtasks as unknown[]) : [],
      dependencies: Array.isArray(r.dependencies) ? r.dependencies : [],
      recurrence: r.recurrence && typeof r.recurrence === 'object'
        ? r.recurrence as Task['recurrence']
        : undefined,
      timeEstimate: typeof r.timeEstimate === 'number' ? r.timeEstimate : undefined,
      timeLogs: Array.isArray(r.timeLogs)
        ? (r.timeLogs as { date: string; hours: number; note: string }[])
        : undefined,
      customFields: typeof r.customFields === 'object' && r.customFields !== null
        ? r.customFields as Record<string, unknown>
        : {},
      collapsed: r.collapsed === true,
      createdAt: r.createdAt as string ?? new Date().toISOString(),
      updatedAt: r.updatedAt as string ?? new Date().toISOString(),
    });
  }

  // ─── Save ──────────────────────────────────────────────────────────────────

  async saveProject(project: Project): Promise<void> {
    project.updatedAt = new Date().toISOString();

    // Ensure task subfolder exists
    const taskFolder = this.projectTaskFolder(project);
    await this.ensureFolder(taskFolder);

    // Save all task files
    await this.saveAllTasks(project.tasks, project, null, taskFolder);

    // Save project metadata (no task data in frontmatter)
    const content = this.serializeProject(project);
    const file = this.app.vault.getAbstractFileByPath(project.filePath);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
    } else {
      await this.app.vault.create(project.filePath, content);
    }
  }

  /** Recursively save all tasks as individual .md files */
  private async saveAllTasks(tasks: Task[], project: Project, parentTask: Task | null, folder: string): Promise<void> {
    for (const task of tasks) {
      await this.saveTaskFile(task, project, parentTask, folder);
      if (task.subtasks.length) {
        await this.saveAllTasks(task.subtasks, project, task, folder);
      }
    }
  }

  /** Save a single task to its .md file */
  private async saveTaskFile(task: Task, project: Project, parentTask: Task | null, folder: string): Promise<void> {
    const slug = sanitizeFileName(task.title).toLowerCase().replace(/\s+/g, '-').slice(0, 40);
    const fileName = `${slug}-${task.id.slice(0, 8)}.md`;
    const filePath = normalizePath(`${folder}/${fileName}`);

    // If task already has a filePath and it differs, delete old file
    if (task.filePath && task.filePath !== filePath) {
      const oldFile = this.app.vault.getAbstractFileByPath(task.filePath);
      if (oldFile instanceof TFile) {
        await this.app.vault.delete(oldFile);
      }
    }
    task.filePath = filePath;

    const subtaskIds = task.subtasks.map(s => s.id);
    const fm: Record<string, unknown> = {
      [TASK_FRONTMATTER_KEY]: true,
      projectId: project.id,
      parentId: parentTask?.id ?? null,
      id: task.id,
      title: task.title,
      type: task.type,
      status: task.status,
      priority: task.priority,
      start: task.start,
      due: task.due,
      progress: task.progress,
      assignees: task.assignees,
      tags: task.tags,
      subtaskIds,
      dependencies: task.dependencies,
      collapsed: task.collapsed,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
    if (task.recurrence) fm.recurrence = task.recurrence;
    if (task.timeEstimate !== undefined) fm.timeEstimate = task.timeEstimate;
    if (task.timeLogs?.length) fm.timeLogs = task.timeLogs;
    if (Object.keys(task.customFields).length) fm.customFields = task.customFields;

    const yamlLines: string[] = ['---'];
    this.appendYaml(yamlLines, fm, 0);
    yamlLines.push('---');
    yamlLines.push('');
    const cleanDesc = this.stripAutoGeneratedContent(task.description);
    if (cleanDesc) {
      yamlLines.push(cleanDesc);
      yamlLines.push('');
    }

    // Wiki-links: back-link to parent task or project
    if (parentTask?.filePath) {
      const parentBasename = parentTask.filePath.replace(/^.*\//, '').replace(/\.md$/, '');
      yamlLines.push(`Parent: [[${parentBasename}|${parentTask.title}]]`);
    } else {
      const projectBasename = project.filePath.replace(/^.*\//, '').replace(/\.md$/, '');
      yamlLines.push(`Project: [[${projectBasename}|${project.title}]]`);
    }

    // Wiki-links to subtasks
    if (task.subtasks.length) {
      yamlLines.push('');
      yamlLines.push('## Subtasks');
      for (const sub of task.subtasks) {
        // Subtask filePaths are set during saveAllTasks before this is called for children,
        // but we need to predict the path since children haven't been saved yet
        const subSlug = sanitizeFileName(sub.title).toLowerCase().replace(/\s+/g, '-').slice(0, 40);
        const subBasename = `${subSlug}-${sub.id.slice(0, 8)}`;
        const check = sub.status === 'done' ? 'x' : sub.status === 'cancelled' ? '-' : ' ';
        yamlLines.push(`- [${check}] [[${subBasename}|${sub.title}]]`);
      }
    }

    const content = yamlLines.join('\n');
    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(filePath, content);
    }
  }

  private serializeProject(project: Project): string {
    // Collect top-level task IDs
    const taskIds = project.tasks.map(t => t.id);

    const fm: Record<string, unknown> = {
      [FRONTMATTER_KEY]: true,
      id: project.id,
      title: project.title,
      description: project.description,
      color: project.color,
      icon: project.icon,
      taskIds,
      customFields: project.customFields,
      teamMembers: project.teamMembers,
      savedViews: project.savedViews.length ? project.savedViews : [],
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };

    const yamlLines: string[] = ['---'];
    this.appendYaml(yamlLines, fm, 0);
    yamlLines.push('---');
    yamlLines.push('');
    yamlLines.push(`# ${project.icon} ${project.title}`);
    yamlLines.push('');
    if (project.description) {
      yamlLines.push(project.description);
      yamlLines.push('');
    }
    // Wiki-links to tasks (enables Obsidian graph, backlinks, and navigation)
    if (project.tasks.length) {
      yamlLines.push('## Tasks');
      for (const t of project.tasks) {
        if (t.filePath) {
          const basename = t.filePath.replace(/^.*\//, '').replace(/\.md$/, '');
          const check = t.status === 'done' ? 'x' : t.status === 'cancelled' ? '-' : ' ';
          yamlLines.push(`- [${check}] [[${basename}|${t.title}]]`);
        }
      }
      yamlLines.push('');
    }

    return yamlLines.join('\n');
  }

  /** Minimal YAML serializer (handles strings, numbers, booleans, arrays, objects) */
  private appendYaml(lines: string[], obj: Record<string, unknown>, indent: number): void {
    const pad = '  '.repeat(indent);
    for (const [key, val] of Object.entries(obj)) {
      if (val === null || val === undefined) {
        lines.push(`${pad}${key}:`);
      } else if (typeof val === 'boolean') {
        lines.push(`${pad}${key}: ${val}`);
      } else if (typeof val === 'number') {
        lines.push(`${pad}${key}: ${val}`);
      } else if (typeof val === 'string') {
        const escaped = val.replace(/"/g, '\\"');
        lines.push(`${pad}${key}: "${escaped}"`);
      } else if (Array.isArray(val)) {
        if (val.length === 0) {
          lines.push(`${pad}${key}: []`);
        } else if (typeof val[0] === 'object') {
          lines.push(`${pad}${key}:`);
          for (const item of val) {
            const entries = Object.entries(item as Record<string, unknown>);
            if (entries.length === 0) continue;
            const [firstKey, firstVal] = entries[0];
            lines.push(`${pad}  - ${firstKey}: ${JSON.stringify(firstVal)}`);
            for (const [k, v] of entries.slice(1)) {
              lines.push(`${pad}    ${k}: ${JSON.stringify(v)}`);
            }
          }
        } else {
          const items = val.map(v => JSON.stringify(v)).join(', ');
          lines.push(`${pad}${key}: [${items}]`);
        }
      } else if (typeof val === 'object') {
        const keys = Object.keys(val as object);
        if (keys.length === 0) {
          lines.push(`${pad}${key}: {}`);
        } else {
          lines.push(`${pad}${key}:`);
          this.appendYaml(lines, val as Record<string, unknown>, indent + 1);
        }
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

  async updateTask(project: Project, taskId: string, patch: Partial<Task>): Promise<void> {
    updateTaskInTree(project.tasks, taskId, patch);
    await this.saveProject(project);
  }

  async deleteTask(project: Project, taskId: string): Promise<void> {
    // Delete task file(s) recursively
    const task = findTask(project.tasks, taskId);
    if (task) {
      await this.deleteTaskFiles(task, this.projectTaskFolder(project));
    }
    deleteTaskFromTree(project.tasks, taskId);
    await this.saveProject(project);
  }

  /** Recursively delete task .md files */
  private async deleteTaskFiles(task: Task, folder: string): Promise<void> {
    // Delete subtask files first
    for (const sub of task.subtasks) {
      await this.deleteTaskFiles(sub, folder);
    }
    // Delete this task's file
    if (task.filePath) {
      const file = this.app.vault.getAbstractFileByPath(task.filePath);
      if (file instanceof TFile) await this.app.vault.delete(file);
    }
  }

  async deleteProject(project: Project): Promise<void> {
    // Delete task subfolder
    const taskFolder = this.projectTaskFolder(project);
    const folder = this.app.vault.getAbstractFileByPath(taskFolder);
    if (folder instanceof TFolder) {
      // Delete all files in folder first
      for (const child of folder.children) {
        if (child instanceof TFile) await this.app.vault.delete(child);
      }
      await this.app.vault.delete(folder);
    }
    // Delete project file
    const file = this.app.vault.getAbstractFileByPath(project.filePath);
    if (file instanceof TFile) await this.app.vault.trash(file, true);
  }

  // ─── Frontmatter parser ────────────────────────────────────────────────────

  parseFrontmatter(content: string): {
    frontmatter: Record<string, unknown> | null;
    body: string;
  } {
    if (!content.startsWith('---')) return { frontmatter: null, body: content };
    const end = content.indexOf('\n---', 4);
    if (end === -1) return { frontmatter: null, body: content };
    const raw = content.slice(4, end);
    const body = content.slice(end + 4).trim();
    try {
      // Use Obsidian's built-in YAML parser via parseYaml from obsidian
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { parseYaml } = require('obsidian');
      return { frontmatter: parseYaml(raw) as Record<string, unknown>, body };
    } catch {
      return { frontmatter: null, body: content };
    }
  }

  // ─── Migration helpers (public for migration.ts) ──────────────────────────

  /** Check if a project file uses the old embedded-tasks format */
  isOldFormat(frontmatter: Record<string, unknown>): boolean {
    return Array.isArray(frontmatter.tasks) && frontmatter.tasks.length > 0
      && !Array.isArray(frontmatter.taskIds);
  }

  /** Hydrate tasks from old format (public for migration) */
  hydrateTasksFromOldFormat(raw: unknown[]): Task[] {
    return this.hydrateTasks(raw);
  }
}

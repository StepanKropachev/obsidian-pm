import { Plugin, TFile, WorkspaceLeaf, Notice, SuggestModal } from 'obsidian';
import { DEFAULT_SETTINGS, PMSettings, Project, Task, flattenTasks } from './types';
import { ProjectStore } from './store';
import { PMSettingTab } from './settings';
import { ProjectView, PM_VIEW_TYPE } from './views/ProjectView';
import { ProjectModal } from './modals/ProjectModal';
import { TaskModal } from './modals/TaskModal';
import { Notifier } from './components/Notifier';
import { migrateProjects } from './migration';

export default class PMPlugin extends Plugin {
  settings: PMSettings = { ...DEFAULT_SETTINGS };
  store!: ProjectStore;
  notifier!: Notifier;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = new ProjectStore(this.app);
    this.notifier = new Notifier(this);

    // Register the custom view
    this.registerView(PM_VIEW_TYPE, (leaf) => new ProjectView(leaf, this) as unknown as import('obsidian').View);

    // Open project files in the custom view
    this.registerExtensions([], 'md'); // handled via onOpenFile
    this.app.workspace.onLayoutReady(async () => {
      // Run migration for old-format projects
      await migrateProjects(this);

      this.registerEvent(
        this.app.workspace.on('file-open', async (file: TFile | null) => {
          if (!file) return;
          const cache = this.app.metadataCache.getFileCache(file);
          const fm = cache?.frontmatter;
          if (fm?.['pm-project'] === true) {
            await this.openProjectFile(file);
          }
        }),
      );
    });

    // Ribbon icon
    this.addRibbonIcon('layout-dashboard', 'Project Manager', async () => {
      await this.openProjectsPane();
    });

    // Commands
    this.addCommand({
      id: 'open-projects',
      name: 'Open Projects pane',
      callback: () => this.openProjectsPane(),
    });

    this.addCommand({
      id: 'new-project',
      name: 'Create new project',
      callback: async () => {
        new ProjectModal(this.app, this, null, async project => {
          await this.openProjectFile(
            this.app.vault.getAbstractFileByPath(project.filePath) as TFile,
          );
        }).open();
      },
    });

    this.addCommand({
      id: 'new-task',
      name: 'Create new task',
      callback: () => this.pickProjectThenCreateTask(null),
    });

    this.addCommand({
      id: 'new-subtask',
      name: 'Create new subtask',
      callback: () => this.pickProjectThenCreateTask('pick-parent'),
    });

    // Settings tab
    this.addSettingTab(new PMSettingTab(this.app, this));

    // Start notifier
    this.notifier.start();
  }

  onunload(): void {
    this.notifier.stop();
  }

  async loadSettings(): Promise<void> {
    const saved = await this.loadData() as Partial<PMSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
    // Merge nested arrays carefully
    if (!saved?.statuses?.length) this.settings.statuses = DEFAULT_SETTINGS.statuses;
    if (!saved?.priorities?.length) this.settings.priorities = DEFAULT_SETTINGS.priorities;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async openProjectsPane(): Promise<void> {
    // Open or reveal a project list view in the left sidebar
    const existing = this.app.workspace.getLeavesOfType(PM_VIEW_TYPE + '-list');
    if (existing.length) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: PM_VIEW_TYPE, state: { mode: 'list' } });
    this.app.workspace.revealLeaf(leaf);
  }

  async openProjectFile(file: TFile): Promise<void> {
    // Check if already open
    for (const leaf of this.app.workspace.getLeavesOfType(PM_VIEW_TYPE)) {
      const view = leaf.view as unknown as ProjectView;
      if (view.filePath === file.path) {
        this.app.workspace.revealLeaf(leaf);
        return;
      }
    }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({
      type: PM_VIEW_TYPE,
      state: { filePath: file.path },
    });
    this.app.workspace.revealLeaf(leaf);
  }

  showNotice(msg: string, duration = 3000): void {
    new Notice(msg, duration);
  }

  /** Show project picker, then open TaskModal to create a task (optionally pick parent for subtask) */
  private async pickProjectThenCreateTask(mode: null | 'pick-parent'): Promise<void> {
    const projects = await this.store.loadAllProjects(this.settings.projectsFolder);
    if (!projects.length) {
      this.showNotice('No projects yet. Create a project first.');
      return;
    }
    new ProjectPickerModal(this.app, projects, async (project) => {
      if (mode === 'pick-parent') {
        // Pick a parent task
        const flat = flattenTasks(project.tasks);
        if (!flat.length) {
          this.showNotice('No tasks in this project. Create a task first.');
          return;
        }
        new TaskPickerModal(this.app, flat.map(f => f.task), async (parentTask) => {
          this.openTaskModal(project, parentTask.id);
        }).open();
      } else {
        this.openTaskModal(project, null);
      }
    }).open();
  }

  private openTaskModal(project: Project, parentId: string | null): void {
    new TaskModal(this.app, this, project, null, parentId, async () => {
      await this.store.saveProject(project);
      // Open the project view
      const pFile = this.app.vault.getAbstractFileByPath(project.filePath);
      if (pFile instanceof TFile) {
        await this.openProjectFile(pFile);
      }
    }).open();
  }
}

/** Simple picker modal for selecting a project */
class ProjectPickerModal extends SuggestModal<Project> {
  constructor(
    app: import('obsidian').App,
    private projects: Project[],
    private onChoose: (project: Project) => void,
  ) {
    super(app);
    this.setPlaceholder('Pick a project…');
  }

  getSuggestions(query: string): Project[] {
    const q = query.toLowerCase();
    return this.projects.filter(p => p.title.toLowerCase().includes(q));
  }

  renderSuggestion(project: Project, el: HTMLElement): void {
    el.createEl('span', { text: `${project.icon} ${project.title}` });
  }

  onChooseSuggestion(project: Project): void {
    this.onChoose(project);
  }
}

/** Simple picker modal for selecting a task (parent) */
class TaskPickerModal extends SuggestModal<Task> {
  constructor(
    app: import('obsidian').App,
    private tasks: Task[],
    private onChoose: (task: Task) => void,
  ) {
    super(app);
    this.setPlaceholder('Pick a parent task…');
  }

  getSuggestions(query: string): Task[] {
    const q = query.toLowerCase();
    return this.tasks.filter(t => t.title.toLowerCase().includes(q));
  }

  renderSuggestion(task: Task, el: HTMLElement): void {
    el.createEl('span', { text: task.title });
  }

  onChooseSuggestion(task: Task): void {
    this.onChoose(task);
  }
}

import { Plugin, TFile, Notice } from 'obsidian';
import { DEFAULT_SETTINGS, PMSettings, Project } from './types';
import { flattenTasks } from './store/TaskTreeOps';
import { ProjectStore } from './store';
import { PMSettingTab } from './settings';
import { ProjectView, PM_VIEW_TYPE } from './views/ProjectView';
import { openProjectModal, openTaskModal, openProjectPicker, openTaskPicker } from './ui/ModalFactory';
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
    this.addRibbonIcon('chart-gantt', 'Project Manager', async () => {
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
        openProjectModal(this, { onSave: async project => {
          await this.openProjectFile(
            this.app.vault.getAbstractFileByPath(project.filePath) as TFile,
          );
        } });
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

    // Migrate old icons to no icon
    const oldPrioIcons = ['🔴', '🟠', '🟡', '🟢', '●'];
    const oldStatusIcons = ['○', '◑', '⊘', '◎', '●', '✕'];
    let migrated = false;
    if (this.settings.priorities.some(p => oldPrioIcons.includes(p.icon))) {
      for (const p of this.settings.priorities) {
        if (oldPrioIcons.includes(p.icon)) p.icon = '';
      }
      const colorMap: Record<string, string> = { '#dc2626': '#c47070', '#ea580c': '#b8a06b', '#ca8a04': '#8a94a0', '#16a34a': '#79b58d' };
      for (const p of this.settings.priorities) {
        if (colorMap[p.color]) p.color = colorMap[p.color];
      }
      migrated = true;
    }
    if (this.settings.statuses.some(s => oldStatusIcons.includes(s.icon))) {
      for (const s of this.settings.statuses) {
        if (oldStatusIcons.includes(s.icon)) s.icon = '';
      }
      migrated = true;
    }
    if (migrated) await this.saveSettings();
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
    openProjectPicker(this, projects, async (project) => {
      if (mode === 'pick-parent') {
        // Pick a parent task
        const flat = flattenTasks(project.tasks);
        if (!flat.length) {
          this.showNotice('No tasks in this project. Create a task first.');
          return;
        }
        openTaskPicker(this, flat.map(f => f.task), async (parentTask) => {
          this.openTaskModalForProject(project, parentTask.id);
        });
      } else {
        this.openTaskModalForProject(project, null);
      }
    });
  }

  private openTaskModalForProject(project: Project, parentId: string | null): void {
    openTaskModal(this, project, { parentId, onSave: async () => {
      await this.store.saveProject(project);
      const pFile = this.app.vault.getAbstractFileByPath(project.filePath);
      if (pFile instanceof TFile) {
        await this.openProjectFile(pFile);
      }
    } });
  }
}

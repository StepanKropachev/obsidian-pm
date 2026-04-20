import { Plugin, TFile, Notice } from 'obsidian';
import { DEFAULT_SETTINGS, PMSettings, Project } from './types';
import { flattenTasks } from './store/TaskTreeOps';
import { ProjectStore } from './store';
import { PMSettingTab } from './settings';
import { ProjectView, PM_VIEW_TYPE } from './views/ProjectView';
import { openProjectModal, openTaskModal, openProjectPicker, openTaskPicker, openImportModal } from './ui/ModalFactory';
import { Notifier } from './components/Notifier';
import { migrateProjects } from './migration';
import { safeAsync } from './utils';

export default class PMPlugin extends Plugin {
  settings: PMSettings = { ...DEFAULT_SETTINGS };
  store!: ProjectStore;
  notifier!: Notifier;
  undoStack: Array<{ undo: () => Promise<void> }> = [];

  pushUndo(entry: { undo: () => Promise<void> }): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > 20) this.undoStack.shift();
  }

  async undoLastAction(): Promise<void> {
    const entry = this.undoStack.pop();
    if (entry) await entry.undo();
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = new ProjectStore(this.app, () => this.settings.statuses);
    this.notifier = new Notifier(this);

    // Register the custom view
    this.registerView(PM_VIEW_TYPE, (leaf) => new ProjectView(leaf, this) as unknown as import('obsidian').View);

    // Open project files in the custom view
    this.registerExtensions([], 'md'); // handled via onOpenFile
    this.app.workspace.onLayoutReady(safeAsync(async () => {
      // Run migration for old-format projects
      await migrateProjects(this);

      this.registerEvent(
        this.app.workspace.on('file-open', safeAsync(async (file: TFile | null) => {
          if (!file) return;
          const cache = this.app.metadataCache.getFileCache(file);
          const fm = cache?.frontmatter;
          if (fm?.['pm-project'] === true) {
            await this.openProjectFile(file);
          }
        })),
      );
    }));

    // Ribbon icon
    this.addRibbonIcon('chart-gantt', 'Project manager', async () => {
      await this.openProjectsPane();
    });

    // Commands
    this.addCommand({
      id: 'open-projects',
      name: 'Open projects pane',
      callback: () => { void this.openProjectsPane(); },
    });

    this.addCommand({
      id: 'new-project',
      name: 'Create new project',
      callback: () => {
        openProjectModal(this, { onSave: async project => {
          const file = this.app.vault.getAbstractFileByPath(project.filePath);
          if (file instanceof TFile) await this.openProjectFile(file);
        } });
      },
    });

    this.addCommand({
      id: 'new-task',
      name: 'Create new task',
      callback: () => { void this.pickProjectThenCreateTask(null); },
    });

    this.addCommand({
      id: 'new-subtask',
      name: 'Create new subtask',
      callback: () => { void this.pickProjectThenCreateTask('pick-parent'); },
    });

    this.addCommand({
      id: 'undo-last-action',
      name: 'Undo last action',
      callback: () => { void this.undoLastAction(); },
    });

    this.addCommand({
      id: 'import-notes-as-tasks',
      name: 'Import notes as tasks',
      callback: () => { void this.importNotes(); },
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
    // Migrate: ensure new settings fields exist for older saved data
    if (!this.settings.defaultCurrency) this.settings.defaultCurrency = DEFAULT_SETTINGS.defaultCurrency;
    if (!this.settings.groupColors)    this.settings.groupColors    = {};
    if (!this.settings.collapsedGroups) this.settings.collapsedGroups = [];
    if (!this.settings.globalTableMode) this.settings.globalTableMode = DEFAULT_SETTINGS.globalTableMode;
    if (!this.settings.globalTableProjectColumns?.length) this.settings.globalTableProjectColumns = [...DEFAULT_SETTINGS.globalTableProjectColumns];
    if (!this.settings.projectFilterState) this.settings.projectFilterState = { ...DEFAULT_SETTINGS.projectFilterState };
    if (!this.settings.portfolios) this.settings.portfolios = [];
    if (!this.settings.clients)   this.settings.clients   = [];
    // Migrate old settings.groups → settings.portfolios (rename)
    if ((this.settings as unknown as Record<string, unknown>)['groups'] && !this.settings.portfolios.length) {
      this.settings.portfolios = (this.settings as unknown as Record<string, unknown>)['groups'] as typeof this.settings.portfolios;
    }
    // Ensure projectFilterState has portfolios field (renamed from groups)
    if (!this.settings.projectFilterState.portfolios) {
      const legacy = (this.settings.projectFilterState as unknown as Record<string, unknown>)['groups'];
      this.settings.projectFilterState.portfolios = Array.isArray(legacy) ? legacy as string[] : [];
    }

    // Migrate groupColors → portfolios array (import legacy color data)
    if (this.settings.groupColors && Object.keys(this.settings.groupColors).length > 0) {
      const existingNames = new Set(this.settings.portfolios.map(g => g.name));
      const { makePortfolioConfig } = await import('./types');
      for (const [name, color] of Object.entries(this.settings.groupColors)) {
        if (!existingNames.has(name)) {
          const g = makePortfolioConfig(name);
          g.color = color;
          this.settings.portfolios.push(g);
        }
      }
    }

    // Migrate pre-v1.3 statuses: add `complete` flag if missing
    let migrated = false;
    for (const s of this.settings.statuses) {
      if (s.complete === undefined) {
        s.complete = s.id === 'done' || s.id === 'cancelled';
        migrated = true;
      }
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
      await this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: PM_VIEW_TYPE, state: { mode: 'list' } });
    await this.app.workspace.revealLeaf(leaf);
  }

  async openProjectFile(file: TFile): Promise<void> {
    // Check if already open
    for (const leaf of this.app.workspace.getLeavesOfType(PM_VIEW_TYPE)) {
      const view = leaf.view as unknown as ProjectView;
      if (view.filePath === file.path) {
        await this.app.workspace.revealLeaf(leaf);
        return;
      }
    }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({
      type: PM_VIEW_TYPE,
      state: { filePath: file.path },
    });
    await this.app.workspace.revealLeaf(leaf);
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
    openProjectPicker(this, projects, (project) => {
      if (mode === 'pick-parent') {
        // Pick a parent task
        const flat = flattenTasks(project.tasks);
        if (!flat.length) {
          this.showNotice('No tasks in this project. Create a task first.');
          return;
        }
        openTaskPicker(this, flat.map(f => f.task), (parentTask) => {
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

  private async importNotes(): Promise<void> {
    // Try to find an active project view with a project
    const activeLeaves = this.app.workspace.getLeavesOfType(PM_VIEW_TYPE);
    let activeProject: Project | null = null;

    for (const leaf of activeLeaves) {
      const view = leaf.view as unknown as ProjectView;
      if (view.project) {
        activeProject = view.project;
        break;
      }
    }

    // If a project is open, use it directly
    if (activeProject) {
      const project = activeProject;
      const onImportComplete = async () => {
        const pFile = this.app.vault.getAbstractFileByPath(project.filePath);
        if (pFile instanceof TFile) {
          await this.openProjectFile(pFile);
        }
      };
      openImportModal(this, activeProject, onImportComplete);
      return;
    }

    // Otherwise, show project picker first
    const projects = await this.store.loadAllProjects(this.settings.projectsFolder);
    if (!projects.length) {
      this.showNotice('No projects yet. Create a project first.');
      return;
    }

    openProjectPicker(this, projects, (project) => {
      const onImportComplete = async () => {
        const pFile = this.app.vault.getAbstractFileByPath(project.filePath);
        if (pFile instanceof TFile) {
          await this.openProjectFile(pFile);
        }
      };
      openImportModal(this, project, onImportComplete);
    });
  }
}

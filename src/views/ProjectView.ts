import { ItemView, WorkspaceLeaf, TFile, Menu, EventRef } from 'obsidian';
import type PMPlugin from '../main';
import { Project, ViewMode } from '../types';
import { truncateTitle } from '../utils';
import type { SubView } from './SubView';
import { TableView } from './TableView';
import { GanttView } from './GanttView';
import { KanbanView } from './KanbanView';
import { ProjectModal } from '../modals/ProjectModal';
import { TaskModal } from '../modals/TaskModal';

export const PM_VIEW_TYPE = 'pm-project-view';

interface ViewState {
  filePath?: string;
  mode?: 'list';
  [key: string]: unknown;
}

export class ProjectView extends ItemView {
  plugin: PMPlugin;
  project: Project | null = null;
  filePath = '';
  currentView: ViewMode;
  private subview: SubView | null = null;
  private toolbarEl!: HTMLElement;
  private contentEl2!: HTMLElement;
  private titleEl2!: HTMLElement;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private fileModifyRef: EventRef | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PMPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentView = plugin.settings.defaultView;
  }

  getViewType(): string { return PM_VIEW_TYPE; }
  getDisplayText(): string { return truncateTitle(this.project?.title ?? 'Project Manager', 20); }
  getIcon(): string { return 'layout-dashboard'; }

  async setState(state: ViewState, result: unknown): Promise<void> {
    if (state.filePath) {
      this.filePath = state.filePath;
      await this.loadProject();
    }
    await super.setState(state, result as unknown as import('obsidian').ViewStateResult);
  }

  getState(): ViewState {
    return { filePath: this.filePath };
  }

  async onOpen(): Promise<void> {
    this.containerEl.addClass('pm-view');
    this.buildSkeleton();
    if (this.filePath) await this.loadProject();
    else this.renderProjectList();

    this.keydownHandler = (e: KeyboardEvent) => {
      this.subview?.handleKeyDown?.(e);
    };
    this.containerEl.addEventListener('keydown', this.keydownHandler);
    // Make container focusable so it receives keyboard events
    if (!this.containerEl.hasAttribute('tabindex')) {
      this.containerEl.setAttribute('tabindex', '-1');
    }

    // Watch for task file modifications/deletions to keep the view in sync
    const reloadIfRelevant = (filePath: string) => {
      if (!this.project || !this.filePath) return false;
      const taskFolder = this.filePath.replace(/\.md$/, '_tasks');
      return filePath.startsWith(taskFolder) || filePath === this.filePath;
    };
    this.fileModifyRef = this.app.vault.on('modify', async (file) => {
      if (file instanceof TFile && reloadIfRelevant(file.path)) {
        await this.loadProject();
      }
    });
    this.registerEvent(this.fileModifyRef);
    this.registerEvent(
      this.app.vault.on('delete', async (file) => {
        if (reloadIfRelevant(file.path)) {
          await this.loadProject();
        }
      }),
    );
  }

  async onClose(): Promise<void> {
    if (this.keydownHandler) {
      this.containerEl.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    this.fileModifyRef = null;
    this.subview = null;
  }

  // ─── Skeleton ──────────────────────────────────────────────────────────────

  private buildSkeleton(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('pm-root');

    // Toolbar
    this.toolbarEl = root.createDiv('pm-toolbar');

    // Content area
    this.contentEl2 = root.createDiv('pm-content');
  }

  // ─── Project list (when no file is open) ───────────────────────────────────

  private renderProjectList(): void {
    this.toolbarEl.empty();
    this.toolbarEl.createEl('h2', { text: '📋 Project Manager', cls: 'pm-toolbar-title' });

    const newBtn = this.toolbarEl.createEl('button', { text: '+ New Project', cls: 'pm-btn pm-btn-primary' });
    newBtn.addEventListener('click', async () => {
      new ProjectModal(this.app, this.plugin, null, async project => {
        const file = this.app.vault.getAbstractFileByPath(project.filePath) as TFile;
        if (file) await this.plugin.openProjectFile(file);
      }).open();
    });

    this.contentEl2.empty();
    this.contentEl2.addClass('pm-project-list-container');
    this.renderProjectListContent();
  }

  private async renderProjectListContent(): Promise<void> {
    this.contentEl2.empty();
    const projects = await this.plugin.store.loadAllProjects(this.plugin.settings.projectsFolder);

    if (projects.length === 0) {
      const empty = this.contentEl2.createDiv('pm-empty-state');
      empty.createEl('div', { text: '📋', cls: 'pm-empty-icon' });
      empty.createEl('h3', { text: 'No projects yet' });
      empty.createEl('p', { text: 'Create your first project to get started.' });
      const btn = empty.createEl('button', { text: '+ New Project', cls: 'pm-btn pm-btn-primary' });
      btn.addEventListener('click', async () => {
          new ProjectModal(this.app, this.plugin, null, async project => {
          const file = this.app.vault.getAbstractFileByPath(project.filePath) as TFile;
          if (file) await this.plugin.openProjectFile(file);
        }).open();
      });
      return;
    }

    const grid = this.contentEl2.createDiv('pm-project-grid');
    for (const project of projects) {
      const card = grid.createDiv('pm-project-card');
      card.style.setProperty('--pm-project-color', project.color);

      const colorBar = card.createDiv('pm-project-card-bar');
      colorBar.style.background = project.color;

      const body = card.createDiv('pm-project-card-body');
      body.createEl('div', { text: project.icon, cls: 'pm-project-card-icon' });
      body.createEl('h3', { text: project.title, cls: 'pm-project-card-title' });

      const meta = body.createDiv('pm-project-card-meta');
      const total = this.countTasks(project.tasks, false);
      const done = this.countTasks(project.tasks, true);
      meta.createEl('span', { text: `${done}/${total} tasks`, cls: 'pm-project-card-tasks' });

      const progressBar = body.createDiv('pm-project-card-progress');
      const fill = progressBar.createDiv('pm-project-card-progress-fill');
      fill.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
      fill.style.background = project.color;

      card.addEventListener('click', async () => {
        const file = this.app.vault.getAbstractFileByPath(project.filePath);
        if (file instanceof TFile) await this.plugin.openProjectFile(file);
      });

      // Context menu
      card.addEventListener('contextmenu', (e: MouseEvent) => {
        const menu = new Menu();
        menu.addItem(item => item.setTitle('Edit project').setIcon('settings').onClick(async () => {
              new ProjectModal(this.app, this.plugin, project, async () => {
            await this.renderProjectListContent();
          }).open();
        }));
        menu.addItem(item => item.setTitle('Delete project').setIcon('trash').onClick(async () => {
          await this.plugin.store.deleteProject(project);
          await this.renderProjectListContent();
        }));
        menu.showAtMouseEvent(e);
      });
    }
  }

  private countTasks(tasks: import('../types').Task[], doneOnly: boolean): number {
    let n = 0;
    for (const t of tasks) {
      if (!doneOnly || t.status === 'done') n++;
      n += this.countTasks(t.subtasks, doneOnly);
    }
    return n;
  }

  // ─── Project view ──────────────────────────────────────────────────────────

  private async loadProject(): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!(file instanceof TFile)) {
      this.renderProjectList();
      return;
    }
    this.project = await this.plugin.store.loadProject(file);
    if (!this.project) {
      this.renderProjectList();
      return;
    }
    (this.leaf as unknown as { tabHeaderEl?: { setText?: (t: string) => void } }).tabHeaderEl?.setText?.(truncateTitle(this.project.title, 20));
    this.renderProjectToolbar();
    this.renderCurrentView();
  }

  private renderProjectToolbar(): void {
    if (!this.project) return;
    this.toolbarEl.empty();

    // Left: icon, title, description
    const left = this.toolbarEl.createDiv('pm-toolbar-left');
    const iconEl = left.createEl('span', { text: this.project.icon, cls: 'pm-toolbar-icon' });
    iconEl.addEventListener('click', async () => {
      new ProjectModal(this.app, this.plugin, this.project, async updated => {
        this.project = updated;
        this.renderProjectToolbar();
      }).open();
    });

    this.titleEl2 = left.createEl('h2', { text: this.project.title, cls: 'pm-toolbar-title' });
    this.titleEl2.contentEditable = 'true';
    this.titleEl2.addEventListener('blur', async () => {
      if (!this.project) return;
      this.project.title = this.titleEl2.textContent?.trim() ?? this.project.title;
      await this.plugin.store.saveProject(this.project);
    });

    // Center: view switcher
    const switcher = this.toolbarEl.createDiv('pm-view-switcher');
    const views: { mode: ViewMode; icon: string; label: string }[] = [
      { mode: 'table', icon: '≡', label: 'Table' },
      { mode: 'gantt', icon: '▬', label: 'Gantt' },
      { mode: 'kanban', icon: '⊞', label: 'Board' },
    ];
    for (const v of views) {
      const btn = switcher.createEl('button', { cls: 'pm-view-btn' });
      btn.createEl('span', { text: v.icon, cls: 'pm-view-btn-icon' });
      btn.createEl('span', { text: v.label });
      if (v.mode === this.currentView) btn.addClass('pm-view-btn--active');
      btn.addEventListener('click', () => {
        this.currentView = v.mode;
        switcher.querySelectorAll('.pm-view-btn').forEach(b => b.removeClass('pm-view-btn--active'));
        btn.addClass('pm-view-btn--active');
        this.renderCurrentView();
      });
    }

    // Right: actions
    const right = this.toolbarEl.createDiv('pm-toolbar-right');
    const addBtn = right.createEl('button', { text: '+ Add Task', cls: 'pm-btn pm-btn-primary' });
    addBtn.addEventListener('click', async () => {
      if (!this.project) return;
      new TaskModal(this.app, this.plugin, this.project, null, null, async () => {
        await this.refreshProject();
      }).open();
    });

    const settingsBtn = right.createEl('button', { cls: 'pm-btn pm-btn-icon', attr: { 'aria-label': 'Project settings' } });
    settingsBtn.createEl('span', { text: '⚙' });
    settingsBtn.addEventListener('click', async () => {
      new ProjectModal(this.app, this.plugin, this.project, async updated => {
        this.project = updated;
        this.renderProjectToolbar();
        this.renderCurrentView();
      }).open();
    });
  }

  private renderCurrentView(): void {
    if (!this.project) return;
    this.contentEl2.empty();
    this.subview = null;

    switch (this.currentView) {
      case 'table':
        this.subview = new TableView(this.contentEl2, this.project, this.plugin, () => this.refreshProject());
        break;
      case 'gantt':
        this.subview = new GanttView(this.contentEl2, this.project, this.plugin, () => this.refreshProject());
        break;
      case 'kanban':
        this.subview = new KanbanView(this.contentEl2, this.project, this.plugin, () => this.refreshProject());
        break;
    }
    this.subview?.render();
  }

  async refreshProject(): Promise<void> {
    if (!this.filePath) return;
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (file instanceof TFile) {
      this.project = await this.plugin.store.loadProject(file);
    }
    this.renderCurrentView();
  }
}

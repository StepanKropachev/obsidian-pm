import { ItemView, WorkspaceLeaf, TFile, EventRef } from 'obsidian';
import type PMPlugin from '../main';
import { Project, ViewMode } from '../types';
import { truncateTitle, safeAsync } from '../utils';
import type { SubView } from './SubView';
import { TableView } from './table/TableView';
import type { TableViewState } from './table/TableView';
import { GanttView } from './gantt/GanttView';
import { KanbanView } from './KanbanView';
import { openProjectModal, openTaskModal } from '../ui/ModalFactory';
import { renderProjectListToolbar, renderProjectListContent } from './ProjectListRenderer';
import type { ProjectListContext } from './ProjectListRenderer';

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
  private savedTableViewState: TableViewState | null = null;
  private toolbarEl!: HTMLElement;
  private contentEl2!: HTMLElement;
  private titleEl2!: HTMLElement;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private fileModifyRef: EventRef | null = null;
  private renderToken = 0;
  private reloadDebounceTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PMPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentView = plugin.settings.defaultView;
    this.navigation = false;
  }

  getViewType(): string { return PM_VIEW_TYPE; }
  getDisplayText(): string { return truncateTitle(this.project?.title ?? 'PM', 10); }
  getIcon(): string { return 'chart-gantt'; }

  async setState(state: ViewState, result: unknown): Promise<void> {
    if (state.filePath) {
      this.filePath = state.filePath;
      await this.loadProject();
    }
    await super.setState(state, result as import('obsidian').ViewStateResult);
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
    this.fileModifyRef = this.app.vault.on('modify', (file) => {
      if (!(file instanceof TFile) || !reloadIfRelevant(file.path)) return;
      if (this.reloadDebounceTimer !== null) window.clearTimeout(this.reloadDebounceTimer);
      this.reloadDebounceTimer = window.setTimeout(safeAsync(async () => {
        this.reloadDebounceTimer = null;
        await this.loadProject();
      }), 300);
    });
    this.registerEvent(this.fileModifyRef);
    this.registerEvent(
      this.app.vault.on('delete', safeAsync(async (file) => {
        if (reloadIfRelevant(file.path)) {
          await this.loadProject();
        }
      })),
    );
  }

  async onClose(): Promise<void> {
    if (this.keydownHandler) {
      this.containerEl.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    this.fileModifyRef = null;
    this.subview?.destroy?.();
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

  private getProjectListCtx(): ProjectListContext {
    const token = ++this.renderToken;
    return {
      plugin: this.plugin,
      toolbarEl: this.toolbarEl,
      contentEl: this.contentEl2,
      isStale: () => token !== this.renderToken,
      openProjectFile: (file: TFile) => this.plugin.openProjectFile(file),
    };
  }

  private renderProjectList(): void {
    const ctx = this.getProjectListCtx();
    renderProjectListToolbar(ctx);
    this.contentEl2.empty();
    this.contentEl2.addClass('pm-project-list-container');
    void renderProjectListContent(ctx);
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
    // Update tab header text and icon after project loads
    (this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.();
    this.renderProjectToolbar();
    this.renderCurrentView();
  }

  private renderProjectToolbar(): void {
    if (!this.project) return;
    this.toolbarEl.empty();

    // Left: icon, title, description
    const left = this.toolbarEl.createDiv('pm-toolbar-left');
    const iconEl = left.createEl('span', { text: this.project.icon, cls: 'pm-toolbar-icon', attr: { 'aria-label': 'Edit project', role: 'button', tabindex: '0' } });
    iconEl.addEventListener('click', () => {
      openProjectModal(this.plugin, { project: this.project, onSave: updated => {
        this.project = updated;
        this.renderProjectToolbar();
      } });
    });

    this.titleEl2 = left.createEl('h2', { text: this.project.title, cls: 'pm-toolbar-title' });
    this.titleEl2.contentEditable = 'true';
    this.titleEl2.addEventListener('blur', safeAsync(async () => {
      if (!this.project) return;
      this.project.title = this.titleEl2.textContent?.trim() ?? this.project.title;
      await this.plugin.store.saveProject(this.project);
    }));

    // Center: view switcher
    const switcher = this.toolbarEl.createDiv('pm-view-switcher');
    const views: { mode: ViewMode; icon: string; label: string }[] = [
      { mode: 'table', icon: '≡', label: 'Table' },
      { mode: 'gantt', icon: '▬', label: 'Gantt' },
      { mode: 'kanban', icon: '⊞', label: 'Board' },
    ];
    for (const v of views) {
      const btn = switcher.createEl('button', { cls: 'pm-view-btn', attr: { 'aria-label': `Switch to ${v.label} view` } });
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
    const addBtn = right.createEl('button', { text: '+ Add task', cls: 'pm-btn pm-btn-primary' });
    addBtn.addEventListener('click', () => {
      if (!this.project) return;
      openTaskModal(this.plugin, this.project, { onSave: async () => { await this.refreshProject(); } });
    });

    if (this.currentView === 'gantt') {
      const milestoneBtn = right.createEl('button', { text: '+ Milestone', cls: 'pm-btn pm-btn-ghost' });
      milestoneBtn.addEventListener('click', () => {
        if (!this.project) return;
        openTaskModal(this.plugin, this.project, { defaults: { type: 'milestone' }, onSave: async () => { await this.refreshProject(); } });
      });
    }

    const settingsBtn = right.createEl('button', { cls: 'pm-btn pm-btn-icon', attr: { 'aria-label': 'Project settings' } });
    settingsBtn.createEl('span', { text: '⚙' });
    settingsBtn.addEventListener('click', () => {
      openProjectModal(this.plugin, { project: this.project, onSave: updated => {
        this.project = updated;
        this.renderProjectToolbar();
        this.renderCurrentView();
      } });
    });
  }

  private renderCurrentView(): void {
    if (!this.project) return;
    this.renderToken++; // cancel any in-flight project list render

    // Preserve quick-add focus across re-renders
    const quickAddFocused = document.activeElement instanceof HTMLElement
      && document.activeElement.matches('.pm-quick-add-input');

    // Save Gantt scroll position before destroying the old view
    let savedGanttScroll: { top: number; left: number } | null = null;
    if (this.currentView === 'gantt' && this.subview instanceof GanttView) {
      savedGanttScroll = this.subview.getScrollPosition();
    }

    // Save TableView filter/sort state so it survives project reloads
    if (this.subview instanceof TableView) {
      this.savedTableViewState = this.subview.getViewState();
    } else if (this.currentView !== 'table') {
      this.savedTableViewState = null;
    }

    this.subview?.destroy?.();
    this.contentEl2.empty();
    this.subview = null;

    switch (this.currentView) {
      case 'table':
        this.subview = new TableView(this.contentEl2, this.project, this.plugin, () => this.refreshProject(), this.savedTableViewState ?? undefined);
        break;
      case 'gantt': {
        const gantt = new GanttView(this.contentEl2, this.project, this.plugin, () => this.refreshProject());
        if (savedGanttScroll) gantt.setPendingScroll(savedGanttScroll);
        this.subview = gantt;
        break;
      }
      case 'kanban':
        this.subview = new KanbanView(this.contentEl2, this.project, this.plugin, () => this.refreshProject());
        break;
    }
    this.subview?.render();

    // Restore quick-add focus after re-render
    if (quickAddFocused) {
      const newInput = this.contentEl2.querySelector('.pm-quick-add-input') as HTMLInputElement;
      if (newInput) newInput.focus();
    }
  }

  async refreshProject(): Promise<void> {
    if (!this.filePath) return;
    // Cancel any pending file-modify reload — we're handling it here
    if (this.reloadDebounceTimer !== null) {
      window.clearTimeout(this.reloadDebounceTimer);
      this.reloadDebounceTimer = null;
    }
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (file instanceof TFile) {
      this.project = await this.plugin.store.loadProject(file);
    }
    this.renderCurrentView();
  }
}

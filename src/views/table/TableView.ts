import { Notice } from 'obsidian';
import { confirmDialog } from '../../ui/ModalFactory';
import type PMPlugin from '../../main';
import type { Project, FilterState } from '../../types';
import { makeDefaultFilter } from '../../types';
import { findTask } from '../../store/TaskTreeOps';
import { safeAsync } from '../../utils';
import type { SubView } from '../SubView';
import { renderQuickAddBar, focusQuickAdd } from './QuickAddBar';
import { renderSavedViewsBar } from './SavedViewsBar';
import { renderFilterBar } from './FilterBar';
import { renderTable, refreshTableBody, handleTableKeyDown } from './TableRenderer';
import type { SortKey, SortDir, TableState } from './TableRenderer';
import { updateSelectAllCheckbox } from './TableRow';
import { renderBulkActionBar } from './BulkActionBar';
import type { BulkAction } from './BulkActionBar';

export interface TableViewState {
  filter: FilterState;
  sortKey: SortKey;
  sortDir: SortDir;
  activeSavedViewId: string | null;
}

export class TableView implements SubView {
  private state: TableState;
  private activeSavedViewId: string | null;

  constructor(
    private container: HTMLElement,
    private project: Project,
    private plugin: PMPlugin,
    private onRefresh: () => Promise<void>,
    initialState?: TableViewState,
  ) {
    this.state = {
      sortKey: initialState?.sortKey ?? ('status' as SortKey),
      sortDir: initialState?.sortDir ?? ('asc' as SortDir),
      filter: initialState?.filter ?? makeDefaultFilter(),
      selectedTaskId: null,
      selectedTaskIds: new Set(),
      lastCheckedTaskId: null,
      tableBody: null,
    };
    this.activeSavedViewId = initialState?.activeSavedViewId ?? null;
  }

  getViewState(): TableViewState {
    return {
      filter: this.state.filter,
      sortKey: this.state.sortKey,
      sortDir: this.state.sortDir,
      activeSavedViewId: this.activeSavedViewId,
    };
  }

  render(): void {
    this.state.tableBody = null;
    this.container.empty();
    this.container.addClass('pm-table-view');

    renderQuickAddBar(this.container, this.project, this.plugin, this.onRefresh);

    renderSavedViewsBar(this.container, {
      project: this.project,
      plugin: this.plugin,
      filter: this.state.filter,
      sortKey: this.state.sortKey,
      sortDir: this.state.sortDir,
      activeSavedViewId: this.activeSavedViewId,
      setActiveSavedViewId: (id) => { this.activeSavedViewId = id; },
      setFilter: (f) => { this.state.filter = f; },
      setSort: (key, dir) => { this.state.sortKey = key as SortKey; this.state.sortDir = dir as SortDir; },
      rerender: () => this.render(),
    });

    renderFilterBar(this.container, {
      project: this.project,
      plugin: this.plugin,
      filter: this.state.filter,
      setFilter: (f) => { this.state.filter = f; },
      activeSavedViewId: this.activeSavedViewId,
      setActiveSavedViewId: (id) => { this.activeSavedViewId = id; },
      refreshTable: () => this.doRefreshTable(),
      rerender: () => this.render(),
    });

    const ctx = this.makeTableContext();
    renderTable(ctx);
    renderBulkActionBar({ ctx, onAction: safeAsync((a) => this.handleBulkAction(a)) });
  }

  focusQuickAdd(): void {
    focusQuickAdd(this.container);
  }

  handleKeyDown(e: KeyboardEvent): void {
    handleTableKeyDown(e, this.makeTableContext());
  }

  private doRefreshTable(): void {
    if (this.state.tableBody) {
      refreshTableBody(this.makeTableContext());
    } else {
      this.render();
    }
  }

  async handleBulkAction(action: BulkAction): Promise<void> {
    const ids = [...this.state.selectedTaskIds];
    if (!ids.length) return;

    try {
      switch (action.type) {
        case 'set-status':
          await this.plugin.store.updateTasks(this.project, ids, { status: action.status });
          break;
        case 'set-priority':
          await this.plugin.store.updateTasks(this.project, ids, { priority: action.priority });
          break;
        case 'set-assignee':
          if (action.assignee === '') {
            await this.plugin.store.updateTasks(this.project, ids, { assignees: [] });
          } else {
            await this.bulkAddToArray(ids, 'assignees', action.assignee);
          }
          break;
        case 'set-tag':
          if (action.tag === '') {
            await this.plugin.store.updateTasks(this.project, ids, { tags: [] });
          } else {
            await this.bulkAddToArray(ids, 'tags', action.tag);
          }
          break;
        case 'set-due-date':
          await this.plugin.store.updateTasks(this.project, ids, { due: action.due });
          if (this.plugin.settings.autoSchedule) {
            for (const id of ids) {
              await this.plugin.store.scheduleAfterChange(this.project, id, this.plugin.settings.statuses);
            }
          }
          break;
        case 'set-progress':
          await this.plugin.store.updateTasks(this.project, ids, { progress: action.progress });
          break;
        case 'set-parent':
          await this.plugin.store.moveTasks(this.project, ids, action.parentId);
          new Notice(`Moved ${ids.length} task${ids.length > 1 ? 's' : ''} under new parent`);
          break;
        case 'remove-parent':
          await this.plugin.store.moveTasks(this.project, ids, null);
          new Notice(`Moved ${ids.length} task${ids.length > 1 ? 's' : ''} to top level`);
          break;
        case 'archive':
          for (const id of ids) {
            await this.plugin.store.archiveTask(this.project, id);
          }
          new Notice(`Archived ${ids.length} task${ids.length > 1 ? 's' : ''}`);
          break;
        case 'unarchive':
          for (const id of ids) {
            await this.plugin.store.unarchiveTask(this.project, id);
          }
          new Notice(`Unarchived ${ids.length} task${ids.length > 1 ? 's' : ''}`);
          break;
        case 'delete':
          if (!await confirmDialog(this.plugin.app, `Delete ${ids.length} task${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
          await this.plugin.store.deleteTasks(this.project, ids);
          break;
      }
      this.state.selectedTaskIds.clear();
      await this.onRefresh();
    } catch (err) {
      console.error('Bulk action failed', err);
      new Notice('Bulk action failed. Please try again.');
      await this.onRefresh();
    }
  }

  private async bulkAddToArray(ids: string[], field: 'assignees' | 'tags', value: string): Promise<void> {
    for (const id of ids) {
      const task = findTask(this.project.tasks, id);
      if (task && !task[field].includes(value)) {
        task[field] = [...task[field], value];
      }
    }
    await this.plugin.store.saveProject(this.project);
  }

  private updateBulkBar(): void {
    const ctx = this.makeTableContext();
    renderBulkActionBar({ ctx, onAction: safeAsync((a) => this.handleBulkAction(a)) });
  }

  private makeTableContext() {
    return {
      container: this.container,
      project: this.project,
      plugin: this.plugin,
      state: this.state,
      onRefresh: this.onRefresh,
      onSelectionChange: () => { updateSelectAllCheckbox(this.state); this.updateBulkBar(); },
      onBulkDelete: safeAsync(() => this.handleBulkAction({ type: 'delete' })),
    };
  }
}

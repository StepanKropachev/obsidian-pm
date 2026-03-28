import type PMPlugin from '../../main';
import type { Project, FilterState } from '../../types';
import { makeDefaultFilter } from '../../types';
import type { SubView } from '../SubView';
import { renderQuickAddBar, focusQuickAdd } from './QuickAddBar';
import { renderSavedViewsBar } from './SavedViewsBar';
import { renderFilterBar } from './FilterBar';
import { renderTable, refreshTableBody, handleTableKeyDown } from './TableRenderer';
import type { SortKey, SortDir, TableState } from './TableRenderer';

export class TableView implements SubView {
  private state: TableState = {
    sortKey: 'status' as SortKey,
    sortDir: 'asc' as SortDir,
    filter: makeDefaultFilter(),
    selectedTaskId: null,
    tableBody: null,
  };
  private activeSavedViewId: string | null = null;

  constructor(
    private container: HTMLElement,
    private project: Project,
    private plugin: PMPlugin,
    private onRefresh: () => Promise<void>,
  ) {}

  render(): void {
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

  private makeTableContext() {
    return {
      container: this.container,
      project: this.project,
      plugin: this.plugin,
      state: this.state,
      onRefresh: this.onRefresh,
    };
  }
}

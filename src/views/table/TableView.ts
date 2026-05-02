import { Notice } from 'obsidian'
import { confirmDialog } from '../../ui/ModalFactory'
import type PMPlugin from '../../main'
import type { Project, FilterState } from '../../types'
import { findTask } from '../../store/TaskTreeOps'
import { safeAsync } from '../../utils'
import type { SubView } from '../SubView'
import { renderTable, refreshTableBody, handleTableKeyDown } from './TableRenderer'
import type { SortKey, SortDir, TableState } from './TableRenderer'
import { updateSelectAllCheckbox } from './TableRow'
import { renderBulkActionBar } from './BulkActionBar'
import type { BulkAction } from './BulkActionBar'

const taskCount = (n: number) => `${n} task${n === 1 ? '' : 's'}`

export interface TableViewState {
  sortKey: SortKey
  sortDir: SortDir
}

export class TableView implements SubView {
  private state: TableState
  private pendingScrollTop: number | null = null

  constructor(
    private container: HTMLElement,
    private project: Project,
    private plugin: PMPlugin,
    private onRefresh: () => Promise<void>,
    filter: FilterState,
    private onFocusQuickAdd: () => void,
    initialState?: TableViewState
  ) {
    this.state = {
      sortKey: initialState?.sortKey ?? 'status',
      sortDir: initialState?.sortDir ?? 'asc',
      filter,
      selectedTaskId: null,
      selectedTaskIds: new Set(),
      lastCheckedTaskId: null,
      tableBody: null
    }
  }

  getScrollTop(): number {
    const wrapper = this.container.querySelector('.pm-table-wrapper')
    return wrapper?.scrollTop ?? 0
  }

  setPendingScrollTop(top: number): void {
    this.pendingScrollTop = top
  }

  getViewState(): TableViewState {
    return {
      sortKey: this.state.sortKey,
      sortDir: this.state.sortDir
    }
  }

  render(): void {
    this.state.tableBody = null
    this.container.empty()
    this.container.addClass('pm-table-view')

    const ctx = this.makeTableContext()
    renderTable(ctx)
    renderBulkActionBar({ ctx, onAction: safeAsync((a) => this.handleBulkAction(a)) })

    if (this.pendingScrollTop !== null) {
      const wrapper = this.container.querySelector('.pm-table-wrapper')
      if (wrapper) wrapper.scrollTop = this.pendingScrollTop
      this.pendingScrollTop = null
    }
  }

  handleKeyDown(e: KeyboardEvent): void {
    handleTableKeyDown(e, this.makeTableContext())
  }

  private doRefreshTable(): void {
    if (this.state.tableBody) {
      refreshTableBody(this.makeTableContext())
    } else {
      this.render()
    }
  }

  async handleBulkAction(action: BulkAction): Promise<void> {
    const ids = [...this.state.selectedTaskIds]
    if (!ids.length) return

    try {
      switch (action.type) {
        case 'set-status':
          await this.plugin.store.updateTasks(this.project, ids, { status: action.status })
          break
        case 'set-priority':
          await this.plugin.store.updateTasks(this.project, ids, { priority: action.priority })
          break
        case 'set-assignee':
          if (action.assignee === '') {
            await this.plugin.store.updateTasks(this.project, ids, { assignees: [] })
          } else {
            await this.bulkAddToArray(ids, 'assignees', action.assignee)
          }
          break
        case 'set-tag':
          if (action.tag === '') {
            await this.plugin.store.updateTasks(this.project, ids, { tags: [] })
          } else {
            await this.bulkAddToArray(ids, 'tags', action.tag)
          }
          break
        case 'set-due-date':
          await this.plugin.store.updateTasks(this.project, ids, { due: action.due })
          if (this.plugin.settings.autoSchedule) {
            for (const id of ids) {
              await this.plugin.store.scheduleAfterChange(this.project, id, this.plugin.settings.statuses)
            }
          }
          break
        case 'set-progress':
          await this.plugin.store.updateTasks(this.project, ids, { progress: action.progress })
          break
        case 'set-parent':
          await this.plugin.store.moveTasks(this.project, ids, action.parentId)
          new Notice(`Moved ${taskCount(ids.length)} under new parent`)
          break
        case 'remove-parent':
          await this.plugin.store.moveTasks(this.project, ids, null)
          new Notice(`Moved ${taskCount(ids.length)} to top level`)
          break
        case 'archive':
          for (const id of ids) {
            await this.plugin.store.archiveTask(this.project, id)
          }
          new Notice(`Archived ${taskCount(ids.length)}`)
          break
        case 'unarchive':
          for (const id of ids) {
            await this.plugin.store.unarchiveTask(this.project, id)
          }
          new Notice(`Unarchived ${taskCount(ids.length)}`)
          break
        case 'delete':
          if (!(await confirmDialog(this.plugin.app, `Delete ${taskCount(ids.length)}? This cannot be undone.`))) {
            return
          }
          await this.plugin.store.deleteTasks(this.project, ids)
          break
      }
      this.state.selectedTaskIds.clear()
      await this.onRefresh()
    } catch (err) {
      console.error('Bulk action failed', err)
      new Notice('Bulk action failed. Please try again.')
      await this.onRefresh()
    }
  }

  private async bulkAddToArray(ids: string[], field: 'assignees' | 'tags', value: string): Promise<void> {
    for (const id of ids) {
      const task = findTask(this.project.tasks, id)
      if (task && !task[field].includes(value)) {
        task[field] = [...task[field], value]
      }
    }
    await this.plugin.store.saveProject(this.project)
  }

  private updateBulkBar(): void {
    const ctx = this.makeTableContext()
    renderBulkActionBar({ ctx, onAction: safeAsync((a) => this.handleBulkAction(a)) })
  }

  private makeTableContext() {
    return {
      container: this.container,
      project: this.project,
      plugin: this.plugin,
      state: this.state,
      onRefresh: this.onRefresh,
      onFocusQuickAdd: this.onFocusQuickAdd,
      onSelectionChange: () => {
        updateSelectAllCheckbox(this.state)
        this.updateBulkBar()
      },
      onBulkDelete: safeAsync(() => this.handleBulkAction({ type: 'delete' }))
    }
  }
}

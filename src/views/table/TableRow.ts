import { getStatusConfig, isTerminalStatus } from '../../utils'
import type { Task } from '../../types'
import type { TableContext, TableState } from './TableRenderer'
import {
  renderSelectCell,
  renderExpandCell,
  renderTitleCell,
  renderStatusCell,
  renderPriorityCell,
  renderAssigneesCell,
  renderDueDateCell,
  renderProgressCell,
  renderTimeCell,
  renderCustomFieldCells,
  renderActionsCell
} from './TableCellRenderers'

// ─── Row orchestrator ──────────────────────────────────────────────────────────

export function renderTaskRow(
  tbody: HTMLElement,
  task: Task,
  depth: number,
  _parentId: string | null,
  ctx: TableContext
): void {
  const isDone = isTerminalStatus(task.status, ctx.plugin.settings.statuses)
  const statusConfig = getStatusConfig(ctx.plugin.settings.statuses, task.status)

  const row = tbody.createEl('tr', { cls: 'pm-table-row' })
  row.dataset.taskId = task.id
  if (isDone) row.addClass('pm-table-row--done')
  if (task.archived) row.addClass('pm-table-row--archived')
  if (ctx.state.selectedTaskId === task.id) row.addClass('pm-table-row--selected')
  row.style.setProperty('--depth', String(depth))

  row.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (
      target.closest(
        'button, input, .pm-status-badge, .pm-priority-badge, .pm-task-title-text, .pm-due-chip, .pm-due-placeholder, .pm-table-cell-select'
      )
    ) {
      return
    }
    ctx.state.selectedTaskId = task.id
    updateSelectedRow(ctx.state)
  })

  renderSelectCell(row, task, ctx)
  renderExpandCell(row, task, ctx)
  renderTitleCell(row, task, depth, ctx)
  renderStatusCell(row, task, ctx)
  renderPriorityCell(row, task, ctx)
  renderAssigneesCell(row, task)
  renderDueDateCell(row, task, ctx)
  renderProgressCell(row, task, statusConfig?.color)
  renderTimeCell(row, task)
  renderCustomFieldCells(row, task, ctx.project)
  renderActionsCell(row, task, ctx)
}

// ─── Selection ─────────────────────────────────────────────────────────────────

export function updateSelectAllCheckbox(state: TableState): void {
  if (!state.tableBody) return
  const wrapper = state.tableBody.closest('.pm-table-wrapper')
  if (!wrapper) return
  const selectAllCb = wrapper.querySelector<HTMLInputElement>('.pm-select-all-checkbox')
  if (!selectAllCb) return
  const ids = Array.from(state.tableBody.querySelectorAll('tr[data-task-id]')).map(
    (r) => (r as HTMLElement).dataset.taskId!
  )
  if (ids.length === 0) {
    selectAllCb.checked = false
    selectAllCb.indeterminate = false
  } else if (ids.every((id) => state.selectedTaskIds.has(id))) {
    selectAllCb.checked = true
    selectAllCb.indeterminate = false
  } else if (ids.some((id) => state.selectedTaskIds.has(id))) {
    selectAllCb.checked = false
    selectAllCb.indeterminate = true
  } else {
    selectAllCb.checked = false
    selectAllCb.indeterminate = false
  }
}

export function updateSelectedRow(state: TableState): void {
  if (!state.tableBody) return
  state.tableBody.querySelectorAll('.pm-table-row--selected').forEach((r) => r.removeClass('pm-table-row--selected'))
  if (state.selectedTaskId) {
    const row = state.tableBody.querySelector(`tr[data-task-id="${state.selectedTaskId}"]`)
    if (row) {
      row.addClass('pm-table-row--selected')
      ;(row as HTMLElement).scrollIntoView({ block: 'nearest' })
    }
  }
}

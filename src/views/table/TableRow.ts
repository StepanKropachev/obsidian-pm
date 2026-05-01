import { getStatusConfig, isTaskOverdue, isTerminalStatus, safeAsync, stringifyCustomValue } from '../../utils'
import { totalLoggedHours } from '../../store/TaskTreeOps'
import { today, parsePlainDate } from '../../dates'
import { COLOR_ACCENT } from '../../constants'
import type { Task } from '../../types'
import type { TableContext, TableState } from './TableRenderer'
import { renderSelectCell, renderExpandCell, renderActionsCell } from './TableCellRenderers'
import { openTaskModal } from '../../ui/ModalFactory'
import { AssigneesCell } from '../../ui/composites/cells/AssigneesCell'
import { CustomFieldCell } from '../../ui/composites/cells/CustomFieldCell'
import { DueDateCell } from '../../ui/composites/cells/DueDateCell'
import { PriorityCell } from '../../ui/composites/cells/PriorityCell'
import { ProgressCell } from '../../ui/composites/cells/ProgressCell'
import { StatusCell } from '../../ui/composites/cells/StatusCell'
import { TimeCell } from '../../ui/composites/cells/TimeCell'
import { TitleCell } from '../../ui/composites/cells/TitleCell'

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
        'button, input, .pm-badge--interactive, .pm-task-title-text, .pm-due-chip, .pm-table-cell-select, .pm-icon-btn'
      )
    ) {
      return
    }
    ctx.state.selectedTaskId = task.id
    updateSelectedRow(ctx.state)
  })

  renderSelectCell(row, task, ctx)
  renderExpandCell(row, task, ctx)

  new TitleCell(row, {
    task,
    depth,
    onTitleClick: () => {
      openTaskModal(ctx.plugin, ctx.project, {
        task,
        onSave: async () => {
          await ctx.onRefresh()
        }
      })
    },
    onTitleSave: async (title) => {
      await ctx.plugin.store.updateTask(ctx.project, task.id, { title })
      await ctx.onRefresh()
    },
    onAddSubtask: () => {
      openTaskModal(ctx.plugin, ctx.project, {
        parentId: task.id,
        onSave: async () => {
          await ctx.onRefresh()
        }
      })
    }
  })

  new StatusCell(row, {
    task,
    statuses: ctx.plugin.settings.statuses,
    onChange: safeAsync(async (status) => {
      await ctx.plugin.store.updateTask(ctx.project, task.id, { status })
      await ctx.onRefresh()
    })
  })

  new PriorityCell(row, {
    task,
    priorities: ctx.plugin.settings.priorities,
    onChange: safeAsync(async (priority) => {
      await ctx.plugin.store.updateTask(ctx.project, task.id, { priority })
      await ctx.onRefresh()
    })
  })

  new AssigneesCell(row, task.assignees)

  const due = parsePlainDate(task.due)
  const overdue = isTaskOverdue(task, ctx.plugin.settings.statuses)
  const isNear = !overdue && due !== null && due.since(today(), { largestUnit: 'days' }).days < 3
  new DueDateCell(row, {
    task,
    urgency: overdue ? 'overdue' : isNear ? 'near' : 'normal',
    onSave: async (val) => {
      await ctx.plugin.store.updateTask(ctx.project, task.id, { due: val })
      await ctx.plugin.store.scheduleAfterChange(ctx.project, task.id, ctx.plugin.settings.statuses)
      await ctx.onRefresh()
    }
  })

  new ProgressCell(row, { value: task.progress, color: statusConfig?.color ?? COLOR_ACCENT })
  new TimeCell(row, { logged: totalLoggedHours(task), estimate: task.timeEstimate ?? 0 })

  for (const cf of ctx.project.customFields) {
    const val = task.customFields[cf.id]
    new CustomFieldCell(row, val !== undefined ? stringifyCustomValue(val) : '')
  }

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

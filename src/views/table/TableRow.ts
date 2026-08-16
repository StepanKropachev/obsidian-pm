import { Menu } from 'obsidian'
import { getStatusConfig, dueUrgency, isTerminalStatus, safeAsync, stringifyCustomValue } from '../../utils'
import { totalLoggedHours } from '../../store/TaskTreeOps'
import { updateSelectCheckboxes, getVisibleTaskIds } from './TableRenderer'
import type { TableContext, TableState, TableTreeRow } from './TableRenderer'
import { openTaskModal } from '../../ui/ModalFactory'
import { buildTaskContextMenu } from '../../ui/TaskContextMenu'
import { TaskRow } from '../../ui/composites/TaskRow'
import { ActionsCell } from '../../ui/composites/cells/ActionsCell'
import { AssigneesCell } from '../../ui/composites/cells/AssigneesCell'
import { CustomFieldCell } from '../../ui/composites/cells/CustomFieldCell'
import { DueDateCell } from '../../ui/composites/cells/DueDateCell'
import { ExpandCell } from '../../ui/composites/cells/ExpandCell'
import { PriorityCell } from '../../ui/composites/cells/PriorityCell'
import { ProjectCell } from '../../ui/composites/cells/ProjectCell'
import { ProgressCell } from '../../ui/composites/cells/ProgressCell'
import { SelectCell } from '../../ui/composites/cells/SelectCell'
import { StatusCell } from '../../ui/composites/cells/StatusCell'
import { TimeCell } from '../../ui/composites/cells/TimeCell'
import { TitleCell } from '../../ui/composites/cells/TitleCell'

export function renderTaskRow(tbody: HTMLElement, flat: TableTreeRow, ctx: TableContext): void {
  const { task, depth } = flat
  // One row belongs to one project, so ownership is resolved here and used throughout.
  const project = ctx.scope.projectOf(task.id)
  if (!project) return
  const isDone = isTerminalStatus(task.status, ctx.scope.configOf(task.id).statuses)
  const statusConfig = getStatusConfig(ctx.statuses, task.status)

  const { el: row } = new TaskRow(tbody, {
    taskId: task.id,
    depth,
    isDone,
    isArchived: !!task.archived,
    isSelected: ctx.state.selectedTaskId === task.id,
    onRowClick: () => {
      ctx.state.selectedTaskId = task.id
      updateSelectedRow(ctx.state)
    }
  })

  new SelectCell(row, {
    checked: ctx.state.selectedTaskIds.has(task.id),
    onClick: (e) => {
      const cb = e.target as HTMLInputElement
      const checked = cb.checked
      if (e.shiftKey && ctx.state.lastCheckedTaskId) {
        const ids = getVisibleTaskIds(ctx.state)
        const curIdx = ids.indexOf(task.id)
        const lastIdx = ids.indexOf(ctx.state.lastCheckedTaskId)
        if (curIdx !== -1 && lastIdx !== -1) {
          const [from, to] = curIdx < lastIdx ? [curIdx, lastIdx] : [lastIdx, curIdx]
          for (let i = from; i <= to; i++) {
            if (checked) ctx.state.selectedTaskIds.add(ids[i])
            else ctx.state.selectedTaskIds.delete(ids[i])
          }
          updateSelectCheckboxes(ctx.state)
        }
      } else if (checked) {
        ctx.state.selectedTaskIds.add(task.id)
      } else {
        ctx.state.selectedTaskIds.delete(task.id)
      }
      ctx.state.lastCheckedTaskId = task.id
      ctx.onSelectionChange()
    }
  })

  new ExpandCell(row, {
    hasSubtasks: task.subtasks.length > 0,
    collapsed: task.collapsed,
    onToggle: safeAsync(async () => {
      await ctx.plugin.toggleTaskCollapsed(project, task.id)
      await ctx.onRefresh()
    })
  })

  new TitleCell(row, {
    task,
    treeGuides: ctx.showSubtreeConnections ? flat.guides : null,
    isLastChild: flat.isLastChild,
    showTagColors: ctx.plugin.settings.showTagColors,
    onTitleClick: () => {
      openTaskModal(ctx.plugin, project, {
        task,
        onSave: async () => {
          await ctx.onRefresh()
        }
      })
    },
    onTitleSave: async (title) => {
      await ctx.plugin.store.updateTask(project, task.id, { title })
      await ctx.onRefresh()
    },
    onAddSubtask: () => {
      openTaskModal(ctx.plugin, project, {
        parentId: task.id,
        onSave: async () => {
          await ctx.onRefresh()
        }
      })
    }
  })

  if (ctx.scope.isMulti) {
    new ProjectCell(row, {
      title: project.title,
      color: project.color,
      onClick: safeAsync(() => ctx.plugin.router.openProjectOverview(project.filePath))
    })
  }

  new StatusCell(row, {
    task,
    statuses: ctx.statuses,
    onChange: safeAsync(async (status) => {
      await ctx.plugin.store.updateTask(project, task.id, { status })
      await ctx.onRefresh()
    })
  })

  new PriorityCell(row, {
    task,
    priorities: ctx.priorities,
    onChange: safeAsync(async (priority) => {
      await ctx.plugin.store.updateTask(project, task.id, { priority })
      await ctx.onRefresh()
    })
  })

  new AssigneesCell(row, task.assignees)

  new DueDateCell(row, {
    task,
    urgency: dueUrgency(task, ctx.statuses),
    onSave: async (val) => {
      await ctx.plugin.store.updateTask(project, task.id, { due: val })
      await ctx.plugin.store.scheduleAfterChange(project, task.id)
      await ctx.onRefresh()
    }
  })

  new ProgressCell(row, {
    value: task.progress,
    color: statusConfig?.color ?? 'var(--interactive-accent)',
    onSave: async (progress) => {
      await ctx.plugin.store.updateTask(project, task.id, { progress })
      await ctx.onRefresh()
    }
  })
  new TimeCell(row, { logged: totalLoggedHours(task), estimate: task.timeEstimate ?? 0 })

  for (const cf of ctx.scope.customFields()) {
    const val = task.customFields[cf.id]
    new CustomFieldCell(row, val !== undefined ? stringifyCustomValue(val) : '')
  }

  new ActionsCell(row, {
    onClick: (e) => {
      const menu = new Menu()
      buildTaskContextMenu(menu, task, { plugin: ctx.plugin, project, onRefresh: ctx.onRefresh })
      menu.showAtMouseEvent(e)
    }
  })
}

export function updateSelectAllCheckbox(state: TableState): void {
  if (!state.tableBody) return
  const wrapper = state.tableBody.closest('.pm-table-wrapper')
  if (!wrapper) return
  const selectAllCb = wrapper.querySelector<HTMLInputElement>('.pm-select-all-checkbox')
  if (!selectAllCb) return
  const ids = getVisibleTaskIds(state)
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
  if (!state.selectedTaskId) return

  let row = state.tableBody.querySelector(`tr[data-task-id="${state.selectedTaskId}"]`)
  if (!row && state.wrapper && state.renderWindow) {
    // Row is outside the virtual window: scroll it into range and re-render.
    const idx = state.visibleRows.findIndex((f) => f.task.id === state.selectedTaskId)
    if (idx === -1) return
    const thead = state.wrapper.querySelector('thead')
    const headerHeight = thead instanceof HTMLElement ? thead.offsetHeight : 0
    state.wrapper.scrollTop = Math.max(0, idx * state.rowHeight + headerHeight - state.wrapper.clientHeight / 2)
    state.renderWindow()
    row = state.tableBody.querySelector(`tr[data-task-id="${state.selectedTaskId}"]`)
  }
  if (row) {
    row.addClass('pm-table-row--selected')
    ;(row as HTMLElement).scrollIntoView({ block: 'nearest' })
  }
}

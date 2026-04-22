import { Menu } from 'obsidian'
import type { Task, Project } from '../../types'
import { totalLoggedHours } from '../../store/TaskTreeOps'
import {
  stringToColor,
  formatDateLong,
  isTaskOverdue,
  getStatusConfig,
  getPriorityConfig,
  safeAsync,
  stringifyCustomValue
} from '../../utils'
import { today, parsePlainDate } from '../../dates'
import { COLOR_ACCENT } from '../../constants'
import { renderStatusBadge, renderPriorityBadge } from '../../ui/StatusBadge'
import { openTaskModal } from '../../ui/ModalFactory'
import { buildTaskContextMenu } from '../../ui/TaskContextMenu'
import { updateSelectCheckboxes, getVisibleTaskIds } from './TableRenderer'
import type { TableContext } from './TableRenderer'

// ─── Inline edit helper ────────────────────────────────────────────────────────

interface InlineEditOpts {
  container: HTMLElement
  display: HTMLElement
  inputType: 'text' | 'date'
  value: string
  onSave: (newValue: string) => Promise<void>
}

export function makeInlineEdit(opts: InlineEditOpts): void {
  const { container, display, inputType, value, onSave } = opts
  const input = container.createEl('input', { type: inputType, cls: 'pm-inline-edit', value })
  display.replaceWith(input)
  input.focus()
  if (inputType === 'text') input.select()

  let saved = false
  const save = safeAsync(async () => {
    if (saved) return
    saved = true
    const newVal = input.value.trim()
    if (newVal !== value) {
      await onSave(newVal)
    } else {
      input.replaceWith(display)
    }
  })

  input.addEventListener('blur', save)
  if (inputType === 'text') {
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') save()
      if (ev.key === 'Escape') input.replaceWith(display)
    })
  } else {
    input.addEventListener('change', save)
  }
}

// ─── Cell renderers ────────────────────────────────────────────────────────────

export function renderSelectCell(row: HTMLElement, task: Task, ctx: TableContext): void {
  const cell = row.createEl('td', { cls: 'pm-table-cell-select' })
  const cb = cell.createEl('input', { type: 'checkbox', cls: 'pm-select-checkbox' })
  cb.checked = ctx.state.selectedTaskIds.has(task.id)
  cb.addEventListener('click', (e) => {
    e.stopPropagation()
    const checked = cb.checked

    if (e.shiftKey && ctx.state.lastCheckedTaskId) {
      const ids = getVisibleTaskIds(ctx.state)
      const curIdx = ids.indexOf(task.id)
      const lastIdx = ids.indexOf(ctx.state.lastCheckedTaskId)
      if (curIdx !== -1 && lastIdx !== -1) {
        const [from, to] = curIdx < lastIdx ? [curIdx, lastIdx] : [lastIdx, curIdx]
        for (let i = from; i <= to; i++) {
          if (checked) {
            ctx.state.selectedTaskIds.add(ids[i])
          } else {
            ctx.state.selectedTaskIds.delete(ids[i])
          }
        }
        updateSelectCheckboxes(ctx.state)
      }
    } else {
      if (checked) {
        ctx.state.selectedTaskIds.add(task.id)
      } else {
        ctx.state.selectedTaskIds.delete(task.id)
      }
    }

    ctx.state.lastCheckedTaskId = task.id
    ctx.onSelectionChange()
  })
}

export function renderExpandCell(row: HTMLElement, task: Task, ctx: TableContext): void {
  const cell = row.createEl('td', { cls: 'pm-table-cell-expand' })
  if (task.subtasks.length > 0) {
    const btn = cell.createEl('button', {
      text: task.collapsed ? '\u25b6' : '\u25bc',
      cls: 'pm-expand-btn',
      attr: { 'aria-label': task.collapsed ? 'Expand subtasks' : 'Collapse subtasks' }
    })
    btn.addEventListener(
      'click',
      safeAsync(async () => {
        await ctx.plugin.store.updateTask(ctx.project, task.id, { collapsed: !task.collapsed })
        await ctx.onRefresh()
      })
    )
  }
}

export function renderTitleCell(row: HTMLElement, task: Task, depth: number, ctx: TableContext): void {
  const cell = row.createEl('td', { cls: 'pm-table-cell-title' })
  cell.style.paddingLeft = `${depth * 20 + 8}px`

  const titleSpan = cell.createEl('span', { text: task.title, cls: 'pm-task-title-text' })
  titleSpan.addEventListener('click', () => {
    openTaskModal(ctx.plugin, ctx.project, {
      task,
      onSave: async () => {
        await ctx.onRefresh()
      }
    })
  })
  titleSpan.addEventListener('dblclick', (e) => {
    e.stopPropagation()
    makeInlineEdit({
      container: cell,
      display: titleSpan,
      inputType: 'text',
      value: task.title,
      onSave: async (val) => {
        await ctx.plugin.store.updateTask(ctx.project, task.id, { title: val })
        await ctx.onRefresh()
      }
    })
  })

  const addSubtaskBtn = cell.createEl('button', {
    cls: 'pm-add-subtask-btn',
    attr: { 'aria-label': 'Add subtask', title: 'Add subtask' }
  })
  addSubtaskBtn.setText('+')
  addSubtaskBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    openTaskModal(ctx.plugin, ctx.project, {
      parentId: task.id,
      onSave: async () => {
        await ctx.onRefresh()
      }
    })
  })

  if (task.type === 'milestone') {
    cell.createEl('span', { text: 'M', cls: 'pm-task-badge pm-task-badge--milestone', attr: { title: 'Milestone' } })
  }
  if (task.type === 'subtask') {
    cell.createEl('span', { text: 'Sub', cls: 'pm-task-badge pm-task-badge--subtask', attr: { title: 'Subtask' } })
  }
  if (task.recurrence) {
    cell.createEl('span', { text: 'R', cls: 'pm-task-badge pm-task-badge--recurrence', attr: { title: 'Recurring' } })
  }
  if (task.archived) {
    cell.createEl('span', {
      text: 'Archived',
      cls: 'pm-task-badge pm-task-badge--archived',
      attr: { title: 'Archived' }
    })
  }

  if (task.tags.length) {
    const tagRow = cell.createDiv('pm-table-tags')
    for (const tag of task.tags) {
      tagRow.createEl('span', { text: tag, cls: 'pm-tag' })
    }
  }
}

export function renderStatusCell(row: HTMLElement, task: Task, ctx: TableContext): void {
  const cell = row.createEl('td', { cls: 'pm-table-cell' })
  const statusConfig = getStatusConfig(ctx.plugin.settings.statuses, task.status)
  if (statusConfig) {
    renderStatusBadge(
      cell,
      task,
      ctx.plugin.settings.statuses,
      safeAsync(async (status) => {
        await ctx.plugin.store.updateTask(ctx.project, task.id, { status })
        await ctx.onRefresh()
      })
    )
  }
}

export function renderPriorityCell(row: HTMLElement, task: Task, ctx: TableContext): void {
  const cell = row.createEl('td', { cls: 'pm-table-cell' })
  const priorityConfig = getPriorityConfig(ctx.plugin.settings.priorities, task.priority)
  if (priorityConfig) {
    renderPriorityBadge(
      cell,
      task,
      ctx.plugin.settings.priorities,
      safeAsync(async (priority) => {
        await ctx.plugin.store.updateTask(ctx.project, task.id, { priority })
        await ctx.onRefresh()
      })
    )
  }
}

export function renderAssigneesCell(row: HTMLElement, task: Task): void {
  const cell = row.createEl('td', { cls: 'pm-table-cell pm-table-cell-assignees' })
  for (const a of task.assignees.slice(0, 3)) {
    const avatar = cell.createEl('span', { cls: 'pm-avatar' })
    avatar.textContent = a.slice(0, 2).toUpperCase()
    avatar.title = a
    avatar.style.background = stringToColor(a)
  }
  if (task.assignees.length > 3) {
    cell.createEl('span', {
      text: `+${task.assignees.length - 3}`,
      cls: 'pm-avatar pm-avatar-more'
    })
  }
}

function startDueDateEdit(cell: HTMLElement, display: HTMLElement, task: Task, ctx: TableContext): void {
  makeInlineEdit({
    container: cell,
    display,
    inputType: 'date',
    value: task.due,
    onSave: async (val) => {
      await ctx.plugin.store.updateTask(ctx.project, task.id, { due: val })
      await ctx.plugin.store.scheduleAfterChange(ctx.project, task.id, ctx.plugin.settings.statuses)
      await ctx.onRefresh()
    }
  })
}

export function renderDueDateCell(row: HTMLElement, task: Task, ctx: TableContext): void {
  const cell = row.createEl('td', { cls: 'pm-table-cell' })

  if (!task.due) {
    const placeholder = cell.createEl('span', { text: '\u2014', cls: 'pm-due-placeholder' })
    placeholder.addEventListener('click', (e) => {
      e.stopPropagation()
      startDueDateEdit(cell, placeholder, task, ctx)
    })
    return
  }

  const due = parsePlainDate(task.due)
  const overdue = isTaskOverdue(task, ctx.plugin.settings.statuses)
  const isNear = !overdue && due !== null && due.since(today(), { largestUnit: 'days' }).days < 3

  const chip = cell.createEl('span', {
    text: formatDateLong(task.due),
    cls: 'pm-due-chip'
  })
  if (overdue) chip.addClass('pm-due-chip--overdue')
  else if (isNear) chip.addClass('pm-due-chip--near')

  chip.addEventListener('click', (e) => {
    e.stopPropagation()
    startDueDateEdit(cell, chip, task, ctx)
  })
}

export function renderProgressCell(row: HTMLElement, task: Task, statusColor: string | undefined): void {
  const cell = row.createEl('td', { cls: 'pm-table-cell pm-table-cell-progress' })
  const wrap = cell.createDiv('pm-progress-wrap')
  const bar = wrap.createDiv('pm-progress-bar')
  const fill = bar.createDiv('pm-progress-fill')
  fill.style.width = `${task.progress}%`
  fill.style.background = statusColor ?? COLOR_ACCENT
  wrap.createEl('span', { text: `${task.progress}%`, cls: 'pm-progress-label' })
}

export function renderTimeCell(row: HTMLElement, task: Task): void {
  const cell = row.createEl('td', { cls: 'pm-table-cell pm-table-cell-time' })
  const logged = totalLoggedHours(task)
  const est = task.timeEstimate ?? 0
  if (logged > 0 || est > 0) {
    const chip = cell.createEl('span', { cls: 'pm-time-chip' })
    chip.setText(est > 0 ? `${logged}/${est}h` : `${logged}h`)
    if (est > 0 && logged > est) chip.addClass('pm-time-chip--over')
  }
}

export function renderActionsCell(row: HTMLElement, task: Task, ctx: TableContext): void {
  const cell = row.createEl('td', { cls: 'pm-table-cell pm-table-cell-actions' })
  const btn = cell.createEl('button', {
    text: '\u22ef',
    cls: 'pm-row-menu-btn',
    attr: { 'aria-label': 'Task actions' }
  })
  btn.addEventListener('click', (e) => {
    const menu = new Menu()
    buildTaskContextMenu(menu, task, { plugin: ctx.plugin, project: ctx.project, onRefresh: ctx.onRefresh })
    menu.showAtMouseEvent(e)
  })
}

export function renderCustomFieldCells(row: HTMLElement, task: Task, project: Project): void {
  for (const cf of project.customFields) {
    const cell = row.createEl('td', { cls: 'pm-table-cell' })
    const val = task.customFields[cf.id]
    const display = val !== undefined ? stringifyCustomValue(val) : ''
    cell.createEl('span', { text: display || '\u2014', cls: 'pm-cf-value' })
  }
}

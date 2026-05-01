import { Menu } from 'obsidian'
import type { Task } from '../../types'
import { safeAsync } from '../../utils'
import { IconButton } from '../../ui/primitives/IconButton'
import { buildTaskContextMenu } from '../../ui/TaskContextMenu'
import { updateSelectCheckboxes, getVisibleTaskIds } from './TableRenderer'
import type { TableContext } from './TableRenderer'

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
    new IconButton(cell)
      .setIcon(task.collapsed ? 'chevron-right' : 'chevron-down')
      .setTooltip(task.collapsed ? 'Expand subtasks' : 'Collapse subtasks')
      .onClick(
        safeAsync(async () => {
          await ctx.plugin.store.updateTask(ctx.project, task.id, { collapsed: !task.collapsed })
          await ctx.onRefresh()
        })
      )
  }
}

export function renderActionsCell(row: HTMLElement, task: Task, ctx: TableContext): void {
  const cell = row.createEl('td', { cls: 'pm-table-cell pm-table-cell-actions' })
  new IconButton(cell)
    .setIcon('more-horizontal')
    .setTooltip('Task actions')
    .setRevealOnHover(true)
    .onClick((e) => {
      const menu = new Menu()
      buildTaskContextMenu(menu, task, { plugin: ctx.plugin, project: ctx.project, onRefresh: ctx.onRefresh })
      menu.showAtMouseEvent(e)
    })
}

import { ButtonComponent, ExtraButtonComponent, Menu } from 'obsidian'
import type { Task, TaskStatus, TaskPriority } from '../../types'
import { findTask, flattenTasks, collectAllAssignees, collectAllTags } from '../../store'
import { formatBadgeText } from '../../utils'
import { today } from '../../dates'
import { promptText } from '../../ui/ModalFactory'
import { TaskPickerModal } from '../../modals/PickerModals'
import type { TableContext } from './TableRenderer'
import { updateSelectAllCheckbox } from './TableRow'

export type BulkAction =
  | { type: 'set-status'; status: TaskStatus }
  | { type: 'set-priority'; priority: TaskPriority }
  | { type: 'set-assignee'; assignee: string }
  | { type: 'set-tag'; tag: string }
  | { type: 'set-due-date'; due: string }
  | { type: 'set-progress'; progress: number }
  | { type: 'set-parent'; parentId: string }
  | { type: 'remove-parent' }
  | { type: 'archive' }
  | { type: 'unarchive' }
  | { type: 'delete' }

export interface BulkActionBarOpts {
  ctx: TableContext
  onAction: (action: BulkAction) => void
}

/**
 * Render or update the bulk action bar.
 * Shows when selectedTaskIds.size > 0, hidden otherwise.
 */
export function renderBulkActionBar(opts: BulkActionBarOpts): void {
  const { ctx, onAction } = opts
  const existing = ctx.container.querySelector('.pm-bulk-bar')

  if (ctx.state.selectedTaskIds.size === 0) {
    existing?.remove()
    return
  }

  // Reuse existing bar or create a new one
  const bar = existing ?? createBar(ctx.container)
  updateBarContent(bar as HTMLElement, ctx, onAction)
}

function createBar(container: HTMLElement): HTMLElement {
  const bar = createDiv({ cls: 'pm-bulk-bar' })
  // Insert after quick-add bar (first child) or at the top
  const quickAdd = container.querySelector('.pm-quick-add')
  if (quickAdd?.nextSibling) {
    container.insertBefore(bar, quickAdd.nextSibling)
  } else if (quickAdd) {
    container.appendChild(bar)
  } else {
    container.prepend(bar)
  }
  return bar
}

function updateBarContent(bar: HTMLElement, ctx: TableContext, onAction: (a: BulkAction) => void): void {
  bar.empty()
  const count = ctx.state.selectedTaskIds.size

  // Left section: count + actions
  const left = bar.createDiv('pm-bulk-bar-left')
  left.createEl('span', { text: `${count} selected`, cls: 'pm-bulk-bar-count' })

  // Status button
  new ButtonComponent(left).setButtonText('Set status').onClick((e) => {
    const menu = new Menu()
    for (const s of ctx.plugin.settings.statuses) {
      menu.addItem((item) =>
        item.setTitle(formatBadgeText(s.icon, s.label)).onClick(() => onAction({ type: 'set-status', status: s.id }))
      )
    }
    menu.showAtMouseEvent(e)
  })

  // Priority button
  new ButtonComponent(left).setButtonText('Set priority').onClick((e) => {
    const menu = new Menu()
    for (const p of ctx.plugin.settings.priorities) {
      menu.addItem((item) =>
        item
          .setTitle(formatBadgeText(p.icon, p.label))
          .onClick(() => onAction({ type: 'set-priority', priority: p.id }))
      )
    }
    menu.showAtMouseEvent(e)
  })

  // Assignee button
  new ButtonComponent(left).setButtonText('Set assignee').onClick((e) => {
    const menu = new Menu()
    const allMembers = collectAllAssignees(ctx.project.tasks, [
      ...ctx.project.teamMembers,
      ...ctx.plugin.settings.globalTeamMembers
    ])
    for (const m of allMembers) {
      menu.addItem((item) => item.setTitle(m).onClick(() => onAction({ type: 'set-assignee', assignee: m })))
    }
    menu.addSeparator()
    menu.addItem((item) =>
      item.setTitle('+ new assignee...').onClick(async () => {
        const name = await promptText(ctx.plugin.app, 'Enter assignee name:', 'Name')
        if (name) onAction({ type: 'set-assignee', assignee: name })
      })
    )
    menu.addSeparator()
    menu.addItem((item) =>
      item.setTitle('Clear assignees').onClick(() => onAction({ type: 'set-assignee', assignee: '' }))
    )
    menu.showAtMouseEvent(e)
  })

  // Tag button
  new ButtonComponent(left).setButtonText('Set tag').onClick((e) => {
    const menu = new Menu()
    const allTags = collectAllTags(ctx.project.tasks)
    for (const t of allTags) {
      menu.addItem((item) => item.setTitle(t).onClick(() => onAction({ type: 'set-tag', tag: t })))
    }
    menu.addSeparator()
    menu.addItem((item) =>
      item.setTitle('+ new tag...').onClick(async () => {
        const tag = await promptText(ctx.plugin.app, 'Enter tag:', 'Tag')
        if (tag) onAction({ type: 'set-tag', tag })
      })
    )
    menu.addSeparator()
    menu.addItem((item) => item.setTitle('Clear tags').onClick(() => onAction({ type: 'set-tag', tag: '' })))
    menu.showAtMouseEvent(e)
  })

  // Due Date button
  new ButtonComponent(left).setButtonText('Set due date').onClick((e) => {
    const menu = new Menu()
    const now = today()
    const ahead = (days: number) => now.add({ days }).toString()
    menu.addItem((item) =>
      item.setTitle(`Today (${ahead(0)})`).onClick(() => onAction({ type: 'set-due-date', due: ahead(0) }))
    )
    menu.addItem((item) =>
      item.setTitle(`Tomorrow (${ahead(1)})`).onClick(() => onAction({ type: 'set-due-date', due: ahead(1) }))
    )
    menu.addItem((item) =>
      item.setTitle(`In 1 week (${ahead(7)})`).onClick(() => onAction({ type: 'set-due-date', due: ahead(7) }))
    )
    menu.addItem((item) =>
      item.setTitle(`In 2 weeks (${ahead(14)})`).onClick(() => onAction({ type: 'set-due-date', due: ahead(14) }))
    )
    menu.addSeparator()
    menu.addItem((item) =>
      item.setTitle('Pick date...').onClick(() => {
        const input = activeDocument.createElement('input')
        input.type = 'date'
        input.addClass('pm-offscreen')
        activeDocument.body.appendChild(input)
        input.addEventListener('change', () => {
          if (input.value) onAction({ type: 'set-due-date', due: input.value })
          input.remove()
        })
        input.addEventListener('blur', () => activeWindow.setTimeout(() => input.remove(), 200))
        input.showPicker()
      })
    )
    menu.addSeparator()
    menu.addItem((item) => item.setTitle('Clear due date').onClick(() => onAction({ type: 'set-due-date', due: '' })))
    menu.showAtMouseEvent(e)
  })

  // Progress button
  new ButtonComponent(left).setButtonText('Set progress').onClick((e) => {
    const menu = new Menu()
    for (const pct of [0, 25, 50, 75, 100]) {
      menu.addItem((item) => item.setTitle(`${pct}%`).onClick(() => onAction({ type: 'set-progress', progress: pct })))
    }
    menu.showAtMouseEvent(e)
  })

  // Set parent / Remove parent buttons
  new ButtonComponent(left).setButtonText('Set parent').onClick(() => {
    const selectedIdSet = new Set(ctx.state.selectedTaskIds)
    // Collect all descendants of selected tasks to prevent circular refs
    const excludedIds = new Set<string>(selectedIdSet)
    for (const id of selectedIdSet) {
      const task = findTask(ctx.project.tasks, id)
      if (task) {
        for (const ft of flattenTasks(task.subtasks)) {
          excludedIds.add(ft.task.id)
        }
      }
    }
    const candidates = flattenTasks(ctx.project.tasks)
      .filter((ft) => !excludedIds.has(ft.task.id))
      .map((ft) => ft.task)
    const modal = new TaskPickerModal(ctx.plugin.app, candidates, (chosen) => {
      onAction({ type: 'set-parent', parentId: chosen.id })
    })
    modal.open()
  })

  new ButtonComponent(left).setButtonText('Remove parent').onClick(() => onAction({ type: 'remove-parent' }))

  // Archive / Unarchive button — show based on selected tasks' state
  const selectedIds = [...ctx.state.selectedTaskIds]
  const selectedTasks = selectedIds.map((id) => findTask(ctx.project.tasks, id)).filter(Boolean) as Task[]
  const hasArchived = selectedTasks.some((t) => t.archived)
  const hasNonArchived = selectedTasks.some((t) => !t.archived)

  if (hasNonArchived) {
    new ButtonComponent(left).setButtonText('Archive').onClick(() => onAction({ type: 'archive' }))
  }
  if (hasArchived) {
    new ButtonComponent(left).setButtonText('Unarchive').onClick(() => onAction({ type: 'unarchive' }))
  }

  // Delete button
  new ButtonComponent(left)
    .setButtonText('Delete')
    .setWarning()
    .onClick(() => onAction({ type: 'delete' }))

  // Right section: clear selection
  const right = bar.createDiv('pm-bulk-bar-right')
  new ExtraButtonComponent(right)
    .setIcon('x')
    .setTooltip('Clear selection')
    .onClick(() => {
      ctx.state.selectedTaskIds.clear()
      if (ctx.state.tableBody) {
        const cbs = ctx.state.tableBody.querySelectorAll('.pm-select-checkbox')
        cbs.forEach((cb) => {
          ;(cb as HTMLInputElement).checked = false
        })
      }
      updateSelectAllCheckbox(ctx.state)
      renderBulkActionBar({ ctx, onAction })
    })
}

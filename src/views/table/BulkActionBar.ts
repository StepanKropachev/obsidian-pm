import { ButtonComponent, ExtraButtonComponent, Menu } from 'obsidian'
import type { Task, TaskStatus, TaskPriority } from '../../types'
import { flattenTasks, collectAllAssignees, collectAllTags } from '../../store'
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

/** Shown only while something is selected. */
export function renderBulkActionBar(opts: BulkActionBarOpts): void {
  const { ctx, onAction } = opts
  const existing = ctx.container.querySelector('.pm-bulk-bar')

  if (ctx.state.selectedTaskIds.size === 0) {
    existing?.remove()
    return
  }

  const bar = existing ?? createBar(ctx.container)
  updateBarContent(bar as HTMLElement, ctx, onAction)
}

function createBar(container: HTMLElement): HTMLElement {
  const bar = createDiv({ cls: 'pm-bulk-bar' })
  container.prepend(bar)
  return bar
}

function updateBarContent(bar: HTMLElement, ctx: TableContext, onAction: (a: BulkAction) => void): void {
  bar.empty()
  const count = ctx.state.selectedTaskIds.size

  const left = bar.createDiv('pm-bulk-bar-left')
  left.createSpan({ text: `${count} selected`, cls: 'pm-bulk-bar-count' })

  new ButtonComponent(left).setButtonText('Set status').onClick((e) => {
    const menu = new Menu()
    for (const s of ctx.statuses) {
      menu.addItem((item) =>
        item.setTitle(formatBadgeText(s.icon, s.label)).onClick(() => onAction({ type: 'set-status', status: s.id }))
      )
    }
    menu.showAtMouseEvent(e)
  })

  new ButtonComponent(left).setButtonText('Set priority').onClick((e) => {
    const menu = new Menu()
    for (const p of ctx.priorities) {
      menu.addItem((item) =>
        item
          .setTitle(formatBadgeText(p.icon, p.label))
          .onClick(() => onAction({ type: 'set-priority', priority: p.id }))
      )
    }
    menu.showAtMouseEvent(e)
  })

  new ButtonComponent(left).setButtonText('Set assignee').onClick((e) => {
    const menu = new Menu()
    const allMembers = collectAllAssignees(ctx.scope.tasks(), [
      ...ctx.scope.teamMembers(),
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

  new ButtonComponent(left).setButtonText('Set tag').onClick((e) => {
    const menu = new Menu()
    const allTags = collectAllTags(ctx.scope.tasks())
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
        const input = activeDocument.createEl('input')
        input.type = 'date'
        input.addClass('pm-offscreen')
        activeDocument.body.appendChild(input)
        input.addEventListener('change', () => {
          if (input.value) onAction({ type: 'set-due-date', due: input.value })
          input.remove()
        })
        input.addEventListener('blur', () => window.setTimeout(() => input.remove(), 200))
        input.showPicker()
      })
    )
    menu.addSeparator()
    menu.addItem((item) => item.setTitle('Clear due date').onClick(() => onAction({ type: 'set-due-date', due: '' })))
    menu.showAtMouseEvent(e)
  })

  new ButtonComponent(left).setButtonText('Set progress').onClick((e) => {
    const menu = new Menu()
    for (const pct of [0, 25, 50, 75, 100]) {
      menu.addItem((item) => item.setTitle(`${pct}%`).onClick(() => onAction({ type: 'set-progress', progress: pct })))
    }
    menu.showAtMouseEvent(e)
  })

  // A parent and its subtask live in the same project, so this is offered only when the
  // whole selection does too.
  const groups = ctx.scope.groupByProject([...ctx.state.selectedTaskIds])
  if (groups.length === 1) {
    const owner = groups[0].project
    new ButtonComponent(left).setButtonText('Set parent').onClick(() => {
      const selectedIdSet = new Set(ctx.state.selectedTaskIds)
      // A selected task's own descendants can't become its parent.
      const excludedIds = new Set<string>(selectedIdSet)
      for (const id of selectedIdSet) {
        const task = ctx.scope.taskById(id)
        if (task) {
          for (const ft of flattenTasks(task.subtasks)) {
            excludedIds.add(ft.task.id)
          }
        }
      }
      const candidates = flattenTasks(owner.tasks)
        .filter((ft) => !excludedIds.has(ft.task.id))
        .map((ft) => ft.task)
      const modal = new TaskPickerModal(ctx.plugin.app, candidates, (chosen) => {
        onAction({ type: 'set-parent', parentId: chosen.id })
      })
      modal.open()
    })
  }

  new ButtonComponent(left).setButtonText('Remove parent').onClick(() => onAction({ type: 'remove-parent' }))

  const selectedIds = [...ctx.state.selectedTaskIds]
  const selectedTasks = selectedIds.map((id) => ctx.scope.taskById(id)).filter(Boolean) as Task[]
  const hasArchived = selectedTasks.some((t) => t.archived)
  const hasNonArchived = selectedTasks.some((t) => !t.archived)

  if (hasNonArchived) {
    new ButtonComponent(left).setButtonText('Archive').onClick(() => onAction({ type: 'archive' }))
  }
  if (hasArchived) {
    new ButtonComponent(left).setButtonText('Unarchive').onClick(() => onAction({ type: 'unarchive' }))
  }

  new ButtonComponent(left)
    .setButtonText('Delete')
    .setDestructive()
    .onClick(() => onAction({ type: 'delete' }))

  const right = bar.createDiv('pm-bulk-bar-right')
  new ExtraButtonComponent(right)
    .setIcon('x')
    .setTooltip('Clear selection')
    .onClick(() => {
      ctx.state.selectedTaskIds.clear()
      if (ctx.state.tableBody) {
        const cbs = ctx.state.tableBody.querySelectorAll('.pm-select-checkbox')
        cbs.forEach((checkbox) => {
          ;(checkbox as HTMLInputElement).checked = false
        })
      }
      updateSelectAllCheckbox(ctx.state)
      renderBulkActionBar({ ctx, onAction })
    })
}

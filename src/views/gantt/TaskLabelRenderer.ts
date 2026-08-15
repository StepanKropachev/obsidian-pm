import type PMPlugin from '../../main'
import type { StatusConfig, Task } from '../../types'
import type { ProjectScope, TaskRef } from '../../store'
import { Chip } from '../../ui/primitives/Chip'
import { CollapseToggle } from '../../ui/primitives/CollapseToggle'
import { IconButton } from '../../ui/primitives/IconButton'
import { openTaskModal } from '../../ui/ModalFactory'
import { renderStatusDot } from '../../ui/StatusBadge'
import { safeAsync } from '../../utils'
import { ROW_HEIGHT } from './TimelineConfig'

export interface LabelContext {
  plugin: PMPlugin
  scope: ProjectScope
  statuses: StatusConfig[]
  onRefresh: () => Promise<void>
}

export function renderTaskLabel(
  container: HTMLElement,
  task: Task,
  depth: number,
  _row: number,
  ctx: LabelContext
): void {
  // One row is one task, so its project is resolved once here.
  const project = ctx.scope.projectOf(task.id)
  if (!project) return
  const el = container.createDiv('pm-gantt-label-row')
  el.style.height = `${ROW_HEIGHT}px`
  el.style.paddingLeft = `${depth * 18 + 8}px`
  el.dataset.taskId = task.id

  el.draggable = true
  el.addEventListener('dragstart', (e: DragEvent) => {
    e.dataTransfer?.setData('text/plain', task.id)
    el.addClass('pm-gantt-label-row--dragging')
  })
  el.addEventListener('dragend', () => {
    el.removeClass('pm-gantt-label-row--dragging')
  })
  let dropPosition: 'before' | 'after' = 'before'
  el.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault()
    const rect = el.getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    dropPosition = e.clientY < midY ? 'before' : 'after'
    el.removeClass('pm-gantt-label-row--drop-before', 'pm-gantt-label-row--drop-after')
    el.addClass(dropPosition === 'before' ? 'pm-gantt-label-row--drop-before' : 'pm-gantt-label-row--drop-after')
  })
  el.addEventListener('dragleave', () => {
    el.removeClass('pm-gantt-label-row--drop-before', 'pm-gantt-label-row--drop-after')
  })
  el.addEventListener(
    'drop',
    safeAsync(async (e: DragEvent) => {
      e.preventDefault()
      el.removeClass('pm-gantt-label-row--drop-before', 'pm-gantt-label-row--drop-after')
      const draggedId = e.dataTransfer?.getData('text/plain')
      if (!draggedId || draggedId === task.id) return
      await ctx.plugin.store.reorderTask(project, draggedId, task.id, dropPosition)
      await ctx.onRefresh()
    })
  )

  if (task.subtasks.length > 0) {
    new CollapseToggle(el, {
      collapsed: task.collapsed,
      onToggle: safeAsync(async () => {
        await ctx.plugin.toggleTaskCollapsed(project, task.id)
        await ctx.onRefresh()
      })
    })
  } else {
    el.createSpan({ cls: 'pm-gantt-label-spacer' })
  }

  renderStatusDot(el, task.status, ctx.statuses, 'pm-gantt-label-dot')

  const titleEl = el.createSpan({ text: task.title, cls: 'pm-gantt-label-title' })
  titleEl.addEventListener('click', () => {
    openTaskModal(ctx.plugin, project, { task, onSave: () => ctx.onRefresh() })
  })

  // With one project the rows are all its own; with several, each says where it belongs.
  if (ctx.scope.isMulti) {
    new Chip(el).setLabel(project.title).setVariant('plain').setSize('sm').setDot(true).setColor(project.color)
  }

  // A predecessor outside this view draws no arrow, so the row says it is there.
  const elsewhere = task.dependencies
    .filter((id) => !ctx.scope.taskById(id))
    .map((id) => ctx.plugin.index.task(id))
    .filter((ref): ref is TaskRef => ref !== null)
  if (elsewhere.length) {
    const names = elsewhere.map((ref) => {
      const owner = ref.projectPath ? ctx.plugin.index.projectRef(ref.projectPath) : null
      return owner ? `${ref.title} (${owner.title})` : ref.title
    })
    new Chip(el)
      .setLabel(`Depends on ${elsewhere.length} elsewhere`)
      .setVariant('plain')
      .setSize('sm')
      .setTooltip(names.join('\n'))
  }

  if (task.progress > 0) {
    el.createSpan({ text: `${task.progress}%`, cls: 'pm-gantt-label-progress' })
  }

  new IconButton(el)
    .setIcon('plus')
    .setTooltip('Add subtask')
    .setRevealOnHover(true)
    .onClick((e) => {
      e.stopPropagation()
      openTaskModal(ctx.plugin, project, { parentId: task.id, onSave: () => ctx.onRefresh() })
    })
}

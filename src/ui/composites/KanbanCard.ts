import type { Task } from '../../types'
import { formatDateShort } from '../../utils'
import { AvatarStack } from '../primitives/AvatarStack'
import { Chip } from '../primitives/Chip'
import { ProgressBar } from '../primitives/ProgressBar'
import { TimeChip } from '../primitives/TimeChip'

export interface KanbanCardProps {
  task: Task
  priorityColor?: string
  descriptionPreview?: string
  parentTitle?: string
  subtaskProgress?: { done: number; total: number }
  loggedHours: number
  overdue: boolean
  onClick: () => void
  onContextMenu: (e: MouseEvent) => void
  onDragStart: () => void
  onDragEnd: () => void
}

export class KanbanCard {
  el: HTMLElement

  constructor(parentEl: HTMLElement, props: KanbanCardProps) {
    const { task } = props
    const card = parentEl.createDiv('pm-kanban-card')
    card.draggable = true
    card.dataset.taskId = task.id
    this.el = card

    if (props.priorityColor) {
      const priorityBar = card.createDiv('pm-kanban-card-priority-bar')
      priorityBar.setCssStyles({ background: props.priorityColor })
    }

    const body = card.createDiv('pm-kanban-card-body')

    if (props.parentTitle) {
      body.createSpan({ text: props.parentTitle, cls: 'pm-kanban-card-parent' })
    }

    const titleRow = body.createDiv('pm-kanban-card-title-row')
    titleRow.createSpan({ text: task.title, cls: 'pm-kanban-card-title' })
    if (task.type === 'milestone') {
      new Chip(titleRow)
        .setLabel('M')
        .setVariant('solid')
        .setSize('sm')
        .setColor('var(--color-purple)')
        .setTooltip('Milestone')
    }
    if (task.type === 'subtask') {
      new Chip(titleRow)
        .setLabel('Sub')
        .setVariant('solid')
        .setSize('sm')
        .setColor('var(--color-green)')
        .setTooltip('Subtask')
    }
    if (task.recurrence) {
      new Chip(titleRow)
        .setLabel('R')
        .setVariant('solid')
        .setSize('sm')
        .setColor('var(--color-blue)')
        .setTooltip('Recurring')
    }

    if (props.descriptionPreview) {
      body.createDiv({ cls: 'pm-kanban-card-description', text: props.descriptionPreview })
    }

    const est = task.timeEstimate ?? 0
    if (props.loggedHours > 0 || est > 0) {
      new TimeChip(body).setSize('sm').setHours(props.loggedHours, est)
    }

    if (task.tags.length) {
      const tagsEl = body.createDiv('pm-kanban-card-tags')
      for (const tag of task.tags.slice(0, 3)) {
        new Chip(tagsEl).setLabel(tag).setVariant('outline').setTag()
      }
    }

    if (task.progress > 0) {
      new ProgressBar(body).setSize('sm').setValue(task.progress)
    }

    if (props.subtaskProgress) {
      const { done, total } = props.subtaskProgress
      body.createSpan({
        text: `${done}/${total} subtasks`,
        cls: 'pm-kanban-card-subtasks'
      })
    }

    const footer = body.createDiv('pm-kanban-card-footer')
    new AvatarStack(footer).setNames(task.assignees).setMax(3).setSize('sm')

    if (task.due) {
      const dueChip = new Chip(footer).setLabel(formatDateShort(task.due)).setSize('sm')
      if (props.overdue) {
        dueChip.setVariant('solid').setColor('var(--color-red)').setStrong()
      }
    }

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', task.id)
      card.addClass('pm-kanban-card--dragging')
      window.setTimeout(() => card.addClass('pm-dragging'), 0)
      props.onDragStart()
    })

    card.addEventListener('dragend', () => {
      card.removeClass('pm-kanban-card--dragging')
      card.removeClass('pm-dragging')
      props.onDragEnd()
    })

    card.addEventListener('click', () => props.onClick())
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      props.onContextMenu(e)
    })
  }
}

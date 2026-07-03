import { setIcon } from 'obsidian'
import type { Task } from '../../types'
import { formatBadgeText, isIconName, safeAsync } from '../../utils'
import { KanbanCard } from './KanbanCard'

export interface KanbanColumnStatus {
  id: string
  label: string
  color: string
  icon: string
}

export interface KanbanCardData {
  task: Task
  priorityColor?: string
  descriptionPreview?: string
  parentTitle?: string
  subtaskProgress?: { done: number; total: number }
  loggedHours: number
  overdue: boolean
  showTagColors: boolean
}

export interface KanbanColumnProps {
  status: KanbanColumnStatus
  cards: KanbanCardData[]
  onCardClick: (task: Task) => void
  onCardContextMenu: (task: Task, e: MouseEvent) => void
  onCardDragStart: (task: Task) => void
  onCardDragEnd: () => void
  onDrop: (taskId: string, newStatus: string) => Promise<void>
}

export class KanbanColumn {
  el: HTMLElement

  constructor(parentEl: HTMLElement, props: KanbanColumnProps) {
    const col = parentEl.createDiv('pm-kanban-col')
    col.dataset.status = props.status.id
    this.el = col

    const header = col.createDiv('pm-kanban-col-header')
    header.style.setProperty('--col-color', props.status.color)

    const topBar = header.createDiv('pm-kanban-col-topbar')
    topBar.setCssStyles({ background: props.status.color })

    const titleRow = header.createDiv('pm-kanban-col-title-row')
    const badge = titleRow.createSpan({ cls: 'pm-kanban-col-badge' })
    if (props.status.icon && isIconName(props.status.icon)) {
      setIcon(badge.createSpan({ cls: 'pm-kanban-col-badge-icon' }), props.status.icon)
      badge.appendText(props.status.label)
    } else {
      badge.setText(formatBadgeText(props.status.icon, props.status.label))
    }
    badge.style.color = props.status.color

    const headerRight = titleRow.createDiv('pm-kanban-col-header-right')
    headerRight.createSpan({
      text: String(props.cards.length),
      cls: 'pm-kanban-col-count'
    })

    const cardsEl = col.createDiv('pm-kanban-cards')
    cardsEl.dataset.status = props.status.id

    for (const card of props.cards) {
      new KanbanCard(cardsEl, {
        task: card.task,
        priorityColor: card.priorityColor,
        descriptionPreview: card.descriptionPreview,
        parentTitle: card.parentTitle,
        subtaskProgress: card.subtaskProgress,
        loggedHours: card.loggedHours,
        overdue: card.overdue,
        showTagColors: card.showTagColors,
        onClick: () => props.onCardClick(card.task),
        onContextMenu: (e) => props.onCardContextMenu(card.task, e),
        onDragStart: () => props.onCardDragStart(card.task),
        onDragEnd: () => props.onCardDragEnd()
      })
    }

    cardsEl.addEventListener('dragover', (e) => {
      e.preventDefault()
      cardsEl.addClass('pm-kanban-drop-target')
      const afterEl = getDragAfterElement(cardsEl, e.clientY)
      const dragging = cardsEl.querySelector('.pm-kanban-card--dragging')
      if (dragging) {
        if (afterEl) {
          cardsEl.insertBefore(dragging, afterEl)
        } else {
          cardsEl.appendChild(dragging)
        }
      }
    })

    cardsEl.addEventListener('dragleave', () => {
      cardsEl.removeClass('pm-kanban-drop-target')
    })

    cardsEl.addEventListener(
      'drop',
      safeAsync(async (e: DragEvent) => {
        e.preventDefault()
        cardsEl.removeClass('pm-kanban-drop-target')
        const taskId = e.dataTransfer?.getData('text/plain') ?? ''
        if (!taskId) return
        await props.onDrop(taskId, props.status.id)
      })
    )
  }
}

function getDragAfterElement(container: HTMLElement, y: number): Element | null {
  const cards = Array.from(container.querySelectorAll('.pm-kanban-card:not(.pm-kanban-card--dragging)'))
  let closest: Element | null = null
  let closestOffset = Number.NEGATIVE_INFINITY
  for (const card of cards) {
    const box = card.getBoundingClientRect()
    const offset = y - box.top - box.height / 2
    if (offset < 0 && offset > closestOffset) {
      closestOffset = offset
      closest = card
    }
  }
  return closest
}

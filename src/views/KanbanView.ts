import { Menu } from 'obsidian'
import type PMPlugin from '../main'
import { Project, Task, TaskStatus } from '../types'
import { totalLoggedHours, flattenTasks } from '../store/TaskTreeOps'
import {
  formatDateShort,
  isTaskOverdue,
  isTerminalStatus,
  getPriorityConfig,
  formatBadgeText,
  safeAsync
} from '../utils'
import { openTaskModal } from '../ui/ModalFactory'
import { AvatarStack } from '../ui/primitives/AvatarStack'
import { Badge } from '../ui/primitives/Badge'
import { Chip } from '../ui/primitives/Chip'
import { DueDateChip } from '../ui/primitives/DueDateChip'
import { ProgressBar } from '../ui/primitives/ProgressBar'
import { buildTaskContextMenu } from '../ui/TaskContextMenu'
import type { SubView } from './SubView'

export class KanbanView implements SubView {
  private dragTask: Task | null = null
  private cleanupFns: (() => void)[] = []

  constructor(
    private container: HTMLElement,
    private project: Project,
    private plugin: PMPlugin,
    private onRefresh: () => Promise<void>
  ) {}

  destroy(): void {
    for (const fn of this.cleanupFns) fn()
    this.cleanupFns = []
  }

  render(): void {
    this.destroy()
    this.container.empty()
    this.container.addClass('pm-kanban-view')

    const board = this.container.createDiv('pm-kanban-board')

    for (const status of this.plugin.settings.statuses) {
      const tasks = this.getTasksForStatus(status.id)
      this.renderColumn(board, status, tasks)
    }
  }

  private getTasksForStatus(status: TaskStatus): Task[] {
    if (this.plugin.settings.kanbanShowSubtasks) {
      return flattenTasks(this.project.tasks)
        .map((ft) => ft.task)
        .filter((t) => t.status === status && !t.archived)
    }
    return this.project.tasks.filter((t) => t.status === status && !t.archived)
  }

  private renderColumn(
    board: HTMLElement,
    status: { id: string; label: string; color: string; icon: string },
    tasks: Task[]
  ): void {
    const col = board.createDiv('pm-kanban-col')
    col.dataset.status = status.id

    // Column header
    const header = col.createDiv('pm-kanban-col-header')
    header.style.setProperty('--col-color', status.color)

    const topBar = header.createDiv('pm-kanban-col-topbar')
    topBar.setCssStyles({ background: status.color })

    const titleRow = header.createDiv('pm-kanban-col-title-row')
    const badge = titleRow.createEl('span', {
      text: formatBadgeText(status.icon, status.label),
      cls: 'pm-kanban-col-badge'
    })
    badge.style.color = status.color

    const headerRight = titleRow.createDiv('pm-kanban-col-header-right')
    headerRight.createEl('span', {
      text: String(tasks.length),
      cls: 'pm-kanban-col-count'
    })

    // Cards container
    const cardsEl = col.createDiv('pm-kanban-cards')
    cardsEl.dataset.status = status.id

    for (const task of tasks) {
      this.renderCard(cardsEl, task, status.color)
    }

    // Drop zone events
    cardsEl.addEventListener('dragover', (e) => {
      e.preventDefault()
      cardsEl.addClass('pm-kanban-drop-target')
      const afterEl = this.getDragAfterElement(cardsEl, e.clientY)
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
        if (!this.dragTask) return
        const newStatus = status.id
        if (newStatus !== this.dragTask.status) {
          await this.plugin.store.updateTask(this.project, this.dragTask.id, { status: newStatus })
          await this.onRefresh()
        }
        this.dragTask = null
      })
    )
  }

  private findParentTask(taskId: string): Task | null {
    for (const ft of flattenTasks(this.project.tasks)) {
      const parent = ft.task
      if (parent.subtasks.some((s) => s.id === taskId)) return parent
    }
    return null
  }

  private renderCard(container: HTMLElement, task: Task, columnColor: string): void {
    const card = container.createDiv('pm-kanban-card')
    card.draggable = true
    card.dataset.taskId = task.id

    const priorityConfig = getPriorityConfig(this.plugin.settings.priorities, task.priority)
    if (priorityConfig && task.priority !== 'medium' && task.priority !== 'low') {
      const priorityBar = card.createDiv('pm-kanban-card-priority-bar')
      priorityBar.setCssStyles({ background: priorityConfig.color })
    }

    const body = card.createDiv('pm-kanban-card-body')

    // Parent label for subtasks shown in flat mode
    if (this.plugin.settings.kanbanShowSubtasks && task.type === 'subtask') {
      const parent = this.findParentTask(task.id)
      if (parent) {
        body.createEl('span', { text: parent.title, cls: 'pm-kanban-card-parent' })
      }
    }

    // Title + type badges
    const titleRow = body.createDiv('pm-kanban-card-title-row')
    titleRow.createEl('span', { text: task.title, cls: 'pm-kanban-card-title' })
    if (task.type === 'milestone') {
      new Badge(titleRow).setLabel('M').setSize('sm').setColor('var(--color-purple)').setTooltip('Milestone')
    }
    if (task.type === 'subtask') {
      new Badge(titleRow).setLabel('Sub').setSize('sm').setColor('var(--color-green)').setTooltip('Subtask')
    }
    if (task.recurrence) {
      new Badge(titleRow).setLabel('R').setSize('sm').setColor('var(--color-blue)').setTooltip('Recurring')
    }

    // Time badge
    const logged = totalLoggedHours(task)
    const est = task.timeEstimate ?? 0
    if (logged > 0 || est > 0) {
      const timeBadge = body.createEl('span', { cls: 'pm-time-chip pm-time-chip--sm' })
      timeBadge.setText(est > 0 ? `${logged}/${est}h` : `${logged}h`)
      if (est > 0 && logged > est) timeBadge.addClass('pm-time-chip--over')
    }

    // Tags
    if (task.tags.length) {
      const tagsEl = body.createDiv('pm-kanban-card-tags')
      for (const tag of task.tags.slice(0, 3)) {
        new Chip(tagsEl).setLabel(tag).setShape('pill').setSize('sm')
      }
    }

    // Footer: assignees + due date
    const footer = body.createDiv('pm-kanban-card-footer')

    new AvatarStack(footer).setNames(task.assignees).setMax(3).setSize('sm')

    if (task.due) {
      const overdue = isTaskOverdue(task, this.plugin.settings.statuses)
      new DueDateChip(footer)
        .setVariant('label')
        .setLabel(formatDateShort(task.due))
        .setUrgency(overdue ? 'overdue' : 'normal')
    }

    // Progress mini bar
    if (task.progress > 0) {
      new ProgressBar(body).setSize('sm').setValue(task.progress)
    }

    // Subtask count
    if (task.subtasks.length) {
      body.createEl('span', {
        text: `${task.subtasks.filter((s) => isTerminalStatus(s.status, this.plugin.settings.statuses)).length}/${task.subtasks.length} subtasks`,
        cls: 'pm-kanban-card-subtasks'
      })
    }

    // Drag events
    card.addEventListener('dragstart', () => {
      this.dragTask = task
      card.addClass('pm-kanban-card--dragging')
      activeWindow.setTimeout(() => card.addClass('pm-dragging'), 0)
    })

    card.addEventListener('dragend', () => {
      card.removeClass('pm-kanban-card--dragging')
      card.removeClass('pm-dragging')
    })

    // Click to open
    card.addEventListener('click', () => {
      openTaskModal(this.plugin, this.project, {
        task,
        onSave: async () => {
          await this.onRefresh()
        }
      })
    })

    // Right-click context menu
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const menu = new Menu()
      buildTaskContextMenu(menu, task, { plugin: this.plugin, project: this.project, onRefresh: this.onRefresh })
      menu.showAtMouseEvent(e)
    })
  }

  private getDragAfterElement(container: HTMLElement, y: number): Element | null {
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
}

import { Menu } from 'obsidian'
import type PMPlugin from '../main'
import { Project, Task, TaskStatus, FilterState } from '../types'
import { flattenTasks, totalLoggedHours } from '../store/TaskTreeOps'
import { matchesFilter } from '../store/TaskFilter'
import { isTaskOverdue, isTerminalStatus, getPriorityConfig } from '../utils'
import { openTaskModal } from '../ui/ModalFactory'
import { buildTaskContextMenu } from '../ui/TaskContextMenu'
import { KanbanColumn, type KanbanCardData } from '../ui/composites/KanbanColumn'
import type { SubView } from './SubView'

export class KanbanView implements SubView {
  private dragTask: Task | null = null

  constructor(
    private container: HTMLElement,
    private project: Project,
    private plugin: PMPlugin,
    private onRefresh: () => Promise<void>,
    private filter: FilterState
  ) {}

  render(): void {
    this.container.empty()
    this.container.addClass('pm-kanban-view')

    const board = this.container.createDiv('pm-kanban-board')

    for (const status of this.plugin.settings.statuses) {
      const tasks = this.getTasksForStatus(status.id)
      const cards = tasks.map((task) => this.buildCardData(task))
      new KanbanColumn(board, {
        status,
        cards,
        onCardClick: (task) => this.openTask(task),
        onCardContextMenu: (task, e) => this.openContextMenu(task, e),
        onCardDragStart: (task) => {
          this.dragTask = task
        },
        onCardDragEnd: () => {
          this.dragTask = null
        },
        onDrop: (taskId, newStatus) => this.handleDrop(taskId, newStatus)
      })
    }
  }

  private getTasksForStatus(status: TaskStatus): Task[] {
    const candidates = this.plugin.settings.kanbanShowSubtasks
      ? flattenTasks(this.project.tasks).map((ft) => ft.task)
      : this.project.tasks
    return candidates.filter((t) => t.status === status && matchesFilter(t, this.filter, this.plugin.settings.statuses))
  }

  private buildCardData(task: Task): KanbanCardData {
    const priorityConfig = getPriorityConfig(this.plugin.settings.priorities, task.priority)
    const priorityColor =
      priorityConfig && task.priority !== 'medium' && task.priority !== 'low' ? priorityConfig.color : undefined

    let parentTitle: string | undefined
    if (this.plugin.settings.kanbanShowSubtasks && task.type === 'subtask') {
      const parent = this.findParentTask(task.id)
      if (parent) parentTitle = parent.title
    }

    let subtaskProgress: { done: number; total: number } | undefined
    if (task.subtasks.length) {
      const done = task.subtasks.filter((s) => isTerminalStatus(s.status, this.plugin.settings.statuses)).length
      subtaskProgress = { done, total: task.subtasks.length }
    }

    return {
      task,
      priorityColor,
      parentTitle,
      subtaskProgress,
      loggedHours: totalLoggedHours(task),
      overdue: isTaskOverdue(task, this.plugin.settings.statuses)
    }
  }

  private findParentTask(taskId: string): Task | null {
    for (const ft of flattenTasks(this.project.tasks)) {
      const parent = ft.task
      if (parent.subtasks.some((s) => s.id === taskId)) return parent
    }
    return null
  }

  private openTask(task: Task): void {
    openTaskModal(this.plugin, this.project, {
      task,
      onSave: async () => {
        await this.onRefresh()
      }
    })
  }

  private openContextMenu(task: Task, e: MouseEvent): void {
    const menu = new Menu()
    buildTaskContextMenu(menu, task, { plugin: this.plugin, project: this.project, onRefresh: this.onRefresh })
    menu.showAtMouseEvent(e)
  }

  private async handleDrop(taskId: string, newStatus: TaskStatus): Promise<void> {
    if (!this.dragTask || this.dragTask.id !== taskId) return
    if (newStatus === this.dragTask.status) return
    await this.plugin.store.updateTask(this.project, this.dragTask.id, { status: newStatus })
    await this.onRefresh()
  }
}

import { Menu, Notice } from 'obsidian';
import type PMPlugin from '../main';
import { Project, Task, TaskStatus } from '../types';
import { flattenTasks, totalLoggedHours } from '../store/TaskTreeOps';
import { stringToColor, formatDateShort, isTaskOverdue, getPriorityConfig, formatBadgeText, safeAsync } from '../utils';
import { openTaskModal, confirmDialog } from '../ui/ModalFactory';
import { COLOR_ACCENT } from '../constants';
import type { SubView } from './SubView';

export class KanbanView implements SubView {
  private dragTask: Task | null = null;
  private cleanupFns: (() => void)[] = [];

  constructor(
    private container: HTMLElement,
    private project: Project,
    private plugin: PMPlugin,
    private onRefresh: () => Promise<void>,
  ) {}

  destroy(): void {
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns = [];
  }

  render(): void {
    this.destroy();
    this.container.empty();
    this.container.addClass('pm-kanban-view');

    const board = this.container.createDiv('pm-kanban-board');

    for (const status of this.plugin.settings.statuses) {
      const tasks = this.getTasksForStatus(status.id as TaskStatus);
      this.renderColumn(board, status, tasks);
    }

  }

  private getTasksForStatus(status: TaskStatus): Task[] {
    // Flatten, filter by status (only top-level for kanban), exclude archived
    return this.project.tasks.filter(t => t.status === status && !t.archived);
  }

  private renderColumn(board: HTMLElement, status: { id: string; label: string; color: string; icon: string }, tasks: Task[]): void {
    const col = board.createDiv('pm-kanban-col');
    col.dataset.status = status.id;

    // Column header
    const header = col.createDiv('pm-kanban-col-header');
    header.style.setProperty('--col-color', status.color);

    const topBar = header.createDiv('pm-kanban-col-topbar');
    topBar.style.background = status.color;
    topBar.style.opacity = '0.5';

    const titleRow = header.createDiv('pm-kanban-col-title-row');
    const badge = titleRow.createEl('span', {
      text: formatBadgeText(status.icon, status.label),
      cls: 'pm-kanban-col-badge',
    });
    badge.style.color = status.color;

    const headerRight = titleRow.createDiv('pm-kanban-col-header-right');
    headerRight.createEl('span', {
      text: String(tasks.length),
      cls: 'pm-kanban-col-count',
    });

    // Cards container
    const cardsEl = col.createDiv('pm-kanban-cards');
    cardsEl.dataset.status = status.id;

    for (const task of tasks) {
      this.renderCard(cardsEl, task, status.color);
    }

    // Drop zone events
    cardsEl.addEventListener('dragover', e => {
      e.preventDefault();
      cardsEl.addClass('pm-kanban-drop-target');
      const afterEl = this.getDragAfterElement(cardsEl, e.clientY);
      const dragging = cardsEl.querySelector('.pm-kanban-card--dragging');
      if (dragging) {
        if (afterEl) {
          cardsEl.insertBefore(dragging, afterEl);
        } else {
          cardsEl.appendChild(dragging);
        }
      }
    });

    cardsEl.addEventListener('dragleave', () => {
      cardsEl.removeClass('pm-kanban-drop-target');
    });

    cardsEl.addEventListener('drop', safeAsync(async (e: DragEvent) => {
      e.preventDefault();
      cardsEl.removeClass('pm-kanban-drop-target');
      if (!this.dragTask) return;
      const newStatus = status.id as TaskStatus;
      if (newStatus !== this.dragTask.status) {
        await this.plugin.store.updateTask(this.project, this.dragTask.id, { status: newStatus });
        await this.onRefresh();
      }
      this.dragTask = null;
    }));

  }

  private renderCard(container: HTMLElement, task: Task, columnColor: string): void {
    const card = container.createDiv('pm-kanban-card');
    card.draggable = true;
    card.dataset.taskId = task.id;

    const priorityConfig = getPriorityConfig(this.plugin.settings.priorities, task.priority);
    if (priorityConfig && task.priority !== 'medium' && task.priority !== 'low') {
      const priorityBar = card.createDiv('pm-kanban-card-priority-bar');
      priorityBar.style.background = priorityConfig.color;
      priorityBar.style.opacity = '0.5';
    }

    const body = card.createDiv('pm-kanban-card-body');

    // Title + type badges
    const titleRow = body.createDiv('pm-kanban-card-title-row');
    titleRow.createEl('span', { text: task.title, cls: 'pm-kanban-card-title' });
    if (task.type === 'milestone') titleRow.createEl('span', { text: 'M', cls: 'pm-task-badge pm-task-badge--milestone', attr: { title: 'Milestone' } });
    if (task.type === 'subtask') titleRow.createEl('span', { text: 'Sub', cls: 'pm-task-badge pm-task-badge--subtask', attr: { title: 'Subtask' } });
    if (task.recurrence) titleRow.createEl('span', { text: 'R', cls: 'pm-task-badge pm-task-badge--recurrence', attr: { title: 'Recurring' } });

    // Time badge
    const logged = totalLoggedHours(task);
    const est = task.timeEstimate ?? 0;
    if (logged > 0 || est > 0) {
      const timeBadge = body.createEl('span', { cls: 'pm-time-chip pm-time-chip--sm' });
      timeBadge.setText(est > 0 ? `${logged}/${est}h` : `${logged}h`);
      if (est > 0 && logged > est) timeBadge.addClass('pm-time-chip--over');
    }

    // Tags
    if (task.tags.length) {
      const tagsEl = body.createDiv('pm-kanban-card-tags');
      for (const tag of task.tags.slice(0, 3)) {
        tagsEl.createEl('span', { text: tag, cls: 'pm-tag pm-tag--sm' });
      }
    }

    // Footer: assignees + due date
    const footer = body.createDiv('pm-kanban-card-footer');

    const avatars = footer.createDiv('pm-kanban-card-avatars');
    for (const a of task.assignees.slice(0, 3)) {
      const av = avatars.createEl('span', { cls: 'pm-avatar pm-avatar--sm' });
      av.textContent = a.slice(0, 2).toUpperCase();
      av.title = a;
      av.style.background = stringToColor(a);
    }

    if (task.due) {
      const overdue = isTaskOverdue(task);
      const chip = footer.createEl('span', {
        text: formatDateShort(task.due),
        cls: 'pm-kanban-due',
      });
      if (overdue) chip.addClass('pm-kanban-due--overdue');
    }

    // Progress mini bar
    if (task.progress > 0) {
      const pbar = body.createDiv('pm-kanban-card-pbar');
      const pfill = pbar.createDiv('pm-kanban-card-pbar-fill');
      pfill.style.width = `${task.progress}%`;
      pfill.style.background = COLOR_ACCENT;
    }

    // Subtask count
    if (task.subtasks.length) {
      body.createEl('span', {
        text: `${task.subtasks.filter(s => s.status === 'done').length}/${task.subtasks.length} subtasks`,
        cls: 'pm-kanban-card-subtasks',
      });
    }

    // Drag events
    card.addEventListener('dragstart', () => {
      this.dragTask = task;
      card.addClass('pm-kanban-card--dragging');
      setTimeout(() => card.style.opacity = '0.5', 0);
    });

    card.addEventListener('dragend', () => {
      card.removeClass('pm-kanban-card--dragging');
      card.style.opacity = '1';
    });

    // Click to open
    card.addEventListener('click', () => {
      openTaskModal(this.plugin, this.project, { task, onSave: async () => { await this.onRefresh(); } });
    });

    // Right-click context menu
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const menu = new Menu();
      menu.addItem(item => item.setTitle('Edit task').setIcon('pencil').onClick(() => {
        openTaskModal(this.plugin, this.project, { task, onSave: async () => { await this.onRefresh(); } });
      }));
      menu.addSeparator();
      if (task.archived) {
        menu.addItem(item => item.setTitle('Unarchive').setIcon('archive-restore').onClick(safeAsync(async () => {
          await this.plugin.store.unarchiveTask(this.project, task.id);
          new Notice('Task unarchived');
          await this.onRefresh();
        })));
      } else {
        menu.addItem(item => item.setTitle('Archive').setIcon('archive').onClick(safeAsync(async () => {
          await this.plugin.store.archiveTask(this.project, task.id);
          new Notice('Task archived');
          await this.onRefresh();
        })));
      }
      menu.addItem(item => item.setTitle('Delete task').setIcon('trash').onClick(safeAsync(async () => {
        if (await confirmDialog(this.plugin.app, `Delete "${task.title}"?`)) {
          await this.plugin.store.deleteTask(this.project, task.id);
          await this.onRefresh();
        }
      })));
      menu.showAtMouseEvent(e as MouseEvent);
    });
  }

  private getDragAfterElement(container: HTMLElement, y: number): Element | null {
    const cards = Array.from(container.querySelectorAll('.pm-kanban-card:not(.pm-kanban-card--dragging)'));
    let closest: Element | null = null;
    let closestOffset = Number.NEGATIVE_INFINITY;
    for (const card of cards) {
      const box = card.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closestOffset) {
        closestOffset = offset;
        closest = card;
      }
    }
    return closest;
  }

}

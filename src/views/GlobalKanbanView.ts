import { Menu } from 'obsidian';
import type PMPlugin from '../main';
import type { Project, Task, TaskStatus } from '../types';
import { flattenTasks, totalLoggedHours } from '../store/TaskTreeOps';
import { stringToColor, formatDateShort, isTaskOverdue, isTerminalStatus, getPriorityConfig, formatBadgeText, safeAsync } from '../utils';
import { openTaskModal } from '../ui/ModalFactory';
import { buildTaskContextMenu } from '../ui/TaskContextMenu';
import type { SubView } from './SubView';

export class GlobalKanbanView implements SubView {
  private dragTask: Task | null = null;
  private dragProject: Project | null = null;
  private cleanupFns: (() => void)[] = [];
  private taskProjectMap = new Map<string, Project>();

  constructor(
    private container: HTMLElement,
    private projects: Project[],
    private plugin: PMPlugin,
    private onRefreshAll: () => Promise<void>,
  ) {}

  destroy(): void {
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns = [];
  }

  render(): void {
    this.destroy();
    this.buildProjectMap();
    this.container.empty();
    this.container.addClass('pm-kanban-view');
    const board = this.container.createDiv('pm-kanban-board');
    for (const status of this.plugin.settings.statuses) {
      const tasks = this.getTasksForStatus(status.id);
      this.renderColumn(board, status, tasks);
    }
  }

  private buildProjectMap(): void {
    this.taskProjectMap.clear();
    for (const p of this.projects) {
      for (const { task } of flattenTasks(p.tasks)) {
        this.taskProjectMap.set(task.id, p);
      }
    }
  }

  private getProject(task: Task): Project {
    return this.taskProjectMap.get(task.id) ?? this.projects[0];
  }

  private getTasksForStatus(status: TaskStatus): Task[] {
    const result: Task[] = [];
    for (const p of this.projects) {
      if (this.plugin.settings.kanbanShowSubtasks) {
        result.push(...flattenTasks(p.tasks).map(ft => ft.task).filter(t => t.status === status && !t.archived));
      } else {
        result.push(...p.tasks.filter(t => t.status === status && !t.archived));
      }
    }
    return result;
  }

  private renderColumn(
    board: HTMLElement,
    status: { id: string; label: string; color: string; icon: string },
    tasks: Task[],
  ): void {
    const col = board.createDiv('pm-kanban-col');
    col.dataset.status = status.id;

    const header = col.createDiv('pm-kanban-col-header');
    header.style.setProperty('--col-color', status.color);
    const topBar = header.createDiv('pm-kanban-col-topbar');
    topBar.setCssStyles({ background: status.color });
    const titleRow = header.createDiv('pm-kanban-col-title-row');
    const badge = titleRow.createEl('span', {
      text: formatBadgeText(status.icon, status.label),
      cls: 'pm-kanban-col-badge',
    });
    badge.style.color = status.color;
    const headerRight = titleRow.createDiv('pm-kanban-col-header-right');
    headerRight.createEl('span', { text: String(tasks.length), cls: 'pm-kanban-col-count' });

    const cardsEl = col.createDiv('pm-kanban-cards');
    cardsEl.dataset.status = status.id;

    for (const task of tasks) {
      this.renderCard(cardsEl, task);
    }

    cardsEl.addEventListener('dragover', e => {
      e.preventDefault();
      cardsEl.addClass('pm-kanban-drop-target');
      const afterEl = this.getDragAfterElement(cardsEl, e.clientY);
      const dragging = cardsEl.querySelector('.pm-kanban-card--dragging');
      if (dragging) {
        if (afterEl) cardsEl.insertBefore(dragging, afterEl);
        else cardsEl.appendChild(dragging);
      }
    });

    cardsEl.addEventListener('dragleave', () => {
      cardsEl.removeClass('pm-kanban-drop-target');
    });

    cardsEl.addEventListener('drop', safeAsync(async (e: DragEvent) => {
      e.preventDefault();
      cardsEl.removeClass('pm-kanban-drop-target');
      if (!this.dragTask || !this.dragProject) return;
      const newStatus = status.id;
      if (newStatus !== this.dragTask.status) {
        await this.plugin.store.updateTask(this.dragProject, this.dragTask.id, { status: newStatus });
        await this.onRefreshAll();
      }
      this.dragTask = null;
      this.dragProject = null;
    }));
  }

  private renderCard(container: HTMLElement, task: Task): void {
    const project = this.getProject(task);
    const card = container.createDiv('pm-kanban-card');
    card.draggable = true;
    card.dataset.taskId = task.id;

    // Thin project color stripe at card top
    const projBar = card.createDiv('pm-kanban-card-proj-bar');
    projBar.style.background = project.color;

    const priorityConfig = getPriorityConfig(this.plugin.settings.priorities, task.priority);
    if (priorityConfig && task.priority !== 'medium' && task.priority !== 'low') {
      const priorityBar = card.createDiv('pm-kanban-card-priority-bar');
      priorityBar.setCssStyles({ background: priorityConfig.color });
    }

    const body = card.createDiv('pm-kanban-card-body');

    // Project badge
    const projBadge = body.createDiv('pm-kanban-card-project');
    const projDot = projBadge.createEl('span', { cls: 'pm-global-project-dot pm-global-project-dot--sm' });
    projDot.style.background = project.color;
    projBadge.createEl('span', { text: project.title, cls: 'pm-kanban-card-project-name' });

    // Title row
    const titleRow = body.createDiv('pm-kanban-card-title-row');
    titleRow.createEl('span', { text: task.title, cls: 'pm-kanban-card-title' });
    if (task.type === 'milestone') {
      titleRow.createEl('span', { text: 'M', cls: 'pm-task-badge pm-task-badge--milestone', attr: { title: 'Milestone' } });
    }
    if (task.type === 'subtask') {
      titleRow.createEl('span', { text: 'Sub', cls: 'pm-task-badge pm-task-badge--subtask', attr: { title: 'Subtask' } });
    }
    if (task.recurrence) {
      titleRow.createEl('span', { text: 'R', cls: 'pm-task-badge pm-task-badge--recurrence', attr: { title: 'Recurring' } });
    }

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

    // Footer: avatars + due date
    const footer = body.createDiv('pm-kanban-card-footer');
    const avatars = footer.createDiv('pm-kanban-card-avatars');
    for (const a of task.assignees.slice(0, 3)) {
      const av = avatars.createEl('span', { cls: 'pm-avatar pm-avatar--sm' });
      av.textContent = a.slice(0, 2).toUpperCase();
      av.title = a;
      av.style.background = stringToColor(a);
    }
    if (task.due) {
      const overdue = isTaskOverdue(task, this.plugin.settings.statuses);
      const chip = footer.createEl('span', { text: formatDateShort(task.due), cls: 'pm-kanban-due' });
      if (overdue) chip.addClass('pm-kanban-due--overdue');
    }

    // Progress bar (project-colored)
    if (task.progress > 0) {
      const pbar = body.createDiv('pm-kanban-card-pbar');
      const pfill = pbar.createDiv('pm-kanban-card-pbar-fill');
      pfill.setCssStyles({ width: `${task.progress}%`, background: project.color });
    }

    // Subtask count
    if (task.subtasks.length) {
      body.createEl('span', {
        text: `${task.subtasks.filter(s => isTerminalStatus(s.status, this.plugin.settings.statuses)).length}/${task.subtasks.length} subtasks`,
        cls: 'pm-kanban-card-subtasks',
      });
    }

    card.addEventListener('dragstart', () => {
      this.dragTask = task;
      this.dragProject = project;
      card.addClass('pm-kanban-card--dragging');
      setTimeout(() => card.addClass('pm-dragging'), 0);
    });
    card.addEventListener('dragend', () => {
      card.removeClass('pm-kanban-card--dragging');
      card.removeClass('pm-dragging');
    });

    card.addEventListener('click', () => {
      openTaskModal(this.plugin, project, { task, onSave: async () => { await this.onRefreshAll(); } });
    });

    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const menu = new Menu();
      buildTaskContextMenu(menu, task, { plugin: this.plugin, project, onRefresh: this.onRefreshAll });
      menu.showAtMouseEvent(e);
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

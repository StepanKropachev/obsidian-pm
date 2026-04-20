import { Menu } from 'obsidian';
import type PMPlugin from '../main';
import type { Project, Task, FilterState, TaskStatus, TaskPriority, DueDateFilter } from '../types';
import { makeDefaultFilter } from '../types';
import type { FlatTask } from '../store/TaskTreeOps';
import { flattenTasks, filterArchived, collectAllAssignees, collectAllTags, totalLoggedHours } from '../store/TaskTreeOps';
import { applyFilters } from './table/TableFilters';
import { renderFilterDropdown } from '../ui/FilterDropdown';
import { renderStatusBadge, renderPriorityBadge } from '../ui/StatusBadge';
import { openTaskModal } from '../ui/ModalFactory';
import { buildTaskContextMenu } from '../ui/TaskContextMenu';
import { isTerminalStatus, formatDateShort, isTaskOverdue, stringToColor, formatBadgeText, safeAsync } from '../utils';
import type { SubView } from './SubView';

type SortKey = 'project' | 'title' | 'status' | 'priority' | 'due' | 'assignees' | 'progress';
type SortDir = 'asc' | 'desc';

interface GlobalFlatTask {
  task: Task;
  project: Project;
  depth: number;
  parentId: string | null;
  visible: boolean;
}

export class GlobalTableView implements SubView {
  private filter: FilterState;
  private sortKey: SortKey = 'project';
  private sortDir: SortDir = 'asc';
  private projectFilter: string[] = [];
  private taskProjectMap = new Map<string, Project>();
  private tableBody: HTMLElement | null = null;

  constructor(
    private container: HTMLElement,
    private projects: Project[],
    private plugin: PMPlugin,
    private onRefreshAll: () => Promise<void>,
  ) {
    this.filter = makeDefaultFilter();
  }

  render(): void {
    this.buildProjectMap();
    this.container.empty();
    this.container.addClass('pm-table-view');
    this.renderFilterBar();
    this.renderTable();
  }

  private buildProjectMap(): void {
    this.taskProjectMap.clear();
    for (const p of this.projects) {
      for (const { task } of flattenTasks(p.tasks)) {
        this.taskProjectMap.set(task.id, p);
      }
    }
  }

  private getAllFlatTasks(): GlobalFlatTask[] {
    const result: GlobalFlatTask[] = [];
    for (const p of this.projects) {
      for (const ft of flattenTasks(filterArchived(p.tasks))) {
        result.push({ task: ft.task, project: p, depth: ft.depth, parentId: ft.parentId, visible: ft.visible });
      }
    }
    return result;
  }

  private refreshTable(): void {
    if (this.tableBody) {
      this.fillTableBody();
    } else {
      this.render();
    }
  }

  private renderFilterBar(): void {
    const bar = this.container.createDiv('pm-filter-bar');

    const search = bar.createEl('input', {
      type: 'text',
      placeholder: 'Search tasks…',
      cls: 'pm-filter-input',
    });
    search.value = this.filter.text;
    search.addEventListener('input', () => {
      this.filter.text = search.value;
      this.refreshTable();
    });

    renderFilterDropdown(bar, 'Status', this.filter.statuses,
      this.plugin.settings.statuses.map(s => ({ id: s.id, label: formatBadgeText(s.icon, s.label) })),
      (selected) => { this.filter.statuses = selected; this.render(); });

    renderFilterDropdown(bar, 'Priority', this.filter.priorities,
      this.plugin.settings.priorities.map(p => ({ id: p.id, label: formatBadgeText(p.icon, p.label) })),
      (selected) => { this.filter.priorities = selected as TaskPriority[]; this.render(); });

    const allAssignees = new Set<string>();
    const allTags = new Set<string>();
    for (const p of this.projects) {
      for (const a of collectAllAssignees(p.tasks)) allAssignees.add(a);
      for (const t of collectAllTags(p.tasks)) allTags.add(t);
    }
    if (allAssignees.size) {
      renderFilterDropdown(bar, 'Assignee', this.filter.assignees,
        [...allAssignees].map(a => ({ id: a, label: a })),
        (selected) => { this.filter.assignees = selected; this.render(); });
    }
    if (allTags.size) {
      renderFilterDropdown(bar, 'Tag', this.filter.tags,
        [...allTags].map(t => ({ id: t, label: t })),
        (selected) => { this.filter.tags = selected; this.render(); });
    }

    renderFilterDropdown(bar, 'Project', this.projectFilter,
      this.projects.map(p => ({ id: p.id, label: p.title })),
      (selected) => { this.projectFilter = selected; this.render(); });

    const dueDateLabels: Record<DueDateFilter, string> = {
      any: 'Due date', overdue: 'Overdue', 'this-week': 'This week',
      'this-month': 'This month', 'no-date': 'No date',
    };
    const dueBtn = bar.createEl('button', {
      text: this.filter.dueDateFilter !== 'any' ? `Due: ${dueDateLabels[this.filter.dueDateFilter]}` : 'Due date',
      cls: 'pm-filter-dropdown-btn',
    });
    if (this.filter.dueDateFilter !== 'any') dueBtn.addClass('pm-filter-dropdown-btn--active');
    dueBtn.addEventListener('click', (e) => {
      const menu = new Menu();
      for (const opt of ['any', 'overdue', 'this-week', 'this-month', 'no-date'] as DueDateFilter[]) {
        menu.addItem(item => item
          .setTitle(dueDateLabels[opt])
          .setChecked(this.filter.dueDateFilter === opt)
          .onClick(() => { this.filter.dueDateFilter = opt; this.render(); }));
      }
      menu.showAtMouseEvent(e);
    });

    const activeCount = this.countActiveFilters();
    if (activeCount > 0) {
      const clearBtn = bar.createEl('button', { text: `✕ Clear (${activeCount})`, cls: 'pm-btn pm-btn-ghost pm-btn-sm' });
      clearBtn.addEventListener('click', () => {
        this.filter = makeDefaultFilter();
        this.projectFilter = [];
        this.render();
      });
    }
  }

  private countActiveFilters(): number {
    let n = 0;
    if (this.filter.text) n++;
    if (this.filter.statuses.length) n++;
    if (this.filter.priorities.length) n++;
    if (this.filter.assignees.length) n++;
    if (this.filter.tags.length) n++;
    if (this.filter.dueDateFilter !== 'any') n++;
    if (this.projectFilter.length) n++;
    return n;
  }

  private renderTable(): void {
    const wrapper = this.container.createDiv('pm-table-wrapper');
    const table = wrapper.createEl('table', { cls: 'pm-table' });
    const thead = table.createEl('thead');
    const hrow = thead.createEl('tr');

    hrow.createEl('th', { cls: 'pm-table-cell-expand' }).setCssStyles({ width: '32px' });

    const cols: { key: SortKey | null; label: string; width?: string }[] = [
      { key: 'project',   label: 'Project',   width: '140px' },
      { key: 'title',     label: 'Task',       width: 'auto'  },
      { key: 'status',    label: 'Status',     width: '130px' },
      { key: 'priority',  label: 'Priority',   width: '110px' },
      { key: 'assignees', label: 'Assignees',  width: '140px' },
      { key: 'due',       label: 'Due',        width: '110px' },
      { key: 'progress',  label: 'Progress',   width: '120px' },
      { key: null,        label: 'Time',       width: '90px'  },
    ];

    for (const col of cols) {
      const th = hrow.createEl('th');
      if (col.width) th.setCssStyles({ width: col.width });
      if (col.key) {
        th.addClass('pm-table-th-sortable');
        th.setAttribute('role', 'button');
        th.createEl('span', { text: col.label });
        if (this.sortKey === col.key) {
          th.createEl('span', { text: this.sortDir === 'asc' ? ' ↑' : ' ↓', cls: 'pm-sort-indicator' });
        }
        const key = col.key;
        th.addEventListener('click', () => {
          if (this.sortKey === key) {
            this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            this.sortKey = key;
            this.sortDir = 'asc';
          }
          this.fillTableBody();
        });
      } else {
        th.setText(col.label);
      }
    }
    hrow.createEl('th').setCssStyles({ width: '40px' });

    this.tableBody = table.createEl('tbody');
    this.fillTableBody();
  }

  private fillTableBody(): void {
    if (!this.tableBody) return;
    this.tableBody.empty();

    let items = this.getAllFlatTasks();

    if (this.projectFilter.length) {
      items = items.filter(i => this.projectFilter.includes(i.project.id));
    }

    const asFlatTasks: FlatTask[] = items.map(i => ({
      task: i.task, depth: i.depth, parentId: i.parentId, visible: i.visible,
    }));
    const filteredFlat = applyFilters(asFlatTasks, this.filter, this.plugin.settings.statuses);
    const filteredIds = new Set(filteredFlat.map(f => f.task.id));
    items = items.filter(i => filteredIds.has(i.task.id));

    items.sort((a, b) => {
      const dir = this.sortDir === 'asc' ? 1 : -1;
      switch (this.sortKey) {
        case 'project':   return dir * a.project.title.localeCompare(b.project.title);
        case 'title':     return dir * a.task.title.localeCompare(b.task.title);
        case 'status':    return dir * a.task.status.localeCompare(b.task.status);
        case 'priority':  return dir * (priorityOrder(a.task.priority) - priorityOrder(b.task.priority));
        case 'due':       return dir * (a.task.due || 'zzz').localeCompare(b.task.due || 'zzz');
        case 'assignees': return dir * (a.task.assignees[0] ?? '').localeCompare(b.task.assignees[0] ?? '');
        case 'progress':  return dir * (a.task.progress - b.task.progress);
        default: return 0;
      }
    });

    for (const item of items) {
      this.renderRow(item);
    }

    if (items.length === 0) {
      const tr = this.tableBody.createEl('tr');
      const td = tr.createEl('td', { attr: { colspan: '10' } });
      td.addClass('pm-table-empty-cell');
      td.setText(this.countActiveFilters() > 0
        ? 'No tasks match the current filters.'
        : 'No tasks across all projects.');
    }
  }

  private renderRow(item: GlobalFlatTask): void {
    const { task, project, depth } = item;
    const isDone = isTerminalStatus(task.status, this.plugin.settings.statuses);

    const row = this.tableBody!.createEl('tr', { cls: 'pm-table-row' });
    row.dataset.taskId = task.id;
    if (isDone) row.addClass('pm-table-row--done');
    row.style.setProperty('--depth', String(depth));

    // Expand / subtask indicator
    const expandCell = row.createEl('td', { cls: 'pm-table-cell-expand' });
    if (task.subtasks.length > 0) {
      expandCell.createEl('span', { text: String(task.subtasks.length), cls: 'pm-subtask-count-badge' });
    }

    // Project cell
    const projectCell = row.createEl('td', { cls: 'pm-global-table-project-cell' });
    const badge = projectCell.createDiv('pm-global-project-badge');
    badge.title = project.title;
    const dot = badge.createEl('span', { cls: 'pm-global-project-dot' });
    dot.style.background = project.color;
    badge.createEl('span', { text: project.title, cls: 'pm-global-project-name' });
    badge.addEventListener('click', safeAsync(async (e: MouseEvent) => {
      e.stopPropagation();
      const { TFile } = await import('obsidian');
      const file = this.plugin.app.vault.getAbstractFileByPath(project.filePath);
      if (file instanceof TFile) await this.plugin.openProjectFile(file);
    }));

    // Title cell
    const titleCell = row.createEl('td', { cls: 'pm-table-cell-title' });
    titleCell.style.paddingLeft = `${depth * 18 + 8}px`;
    const titleText = titleCell.createEl('span', { text: task.title, cls: 'pm-task-title-text' });
    titleText.addEventListener('click', () => {
      openTaskModal(this.plugin, project, { task, onSave: async () => { await this.onRefreshAll(); } });
    });
    if (task.type === 'milestone') {
      titleCell.createEl('span', { text: 'M', cls: 'pm-task-badge pm-task-badge--milestone', attr: { title: 'Milestone' } });
    }
    if (task.recurrence) {
      titleCell.createEl('span', { text: 'R', cls: 'pm-task-badge pm-task-badge--recurrence', attr: { title: 'Recurring' } });
    }

    // Status cell
    const statusCell = row.createEl('td', { cls: 'pm-table-cell-status' });
    renderStatusBadge(statusCell, task, this.plugin.settings.statuses, safeAsync(async (status: TaskStatus) => {
      task.status = status;
      await this.plugin.store.updateTask(project, task.id, { status });
      if (this.plugin.settings.autoSchedule) {
        await this.plugin.store.scheduleAfterChange(project, task.id, this.plugin.settings.statuses);
      }
      await this.onRefreshAll();
    }));

    // Priority cell
    const priorityCell = row.createEl('td', { cls: 'pm-table-cell-priority' });
    renderPriorityBadge(priorityCell, task, this.plugin.settings.priorities, safeAsync(async (priority: TaskPriority) => {
      task.priority = priority;
      await this.plugin.store.updateTask(project, task.id, { priority });
      await this.onRefreshAll();
    }));

    // Assignees cell
    const assigneesCell = row.createEl('td', { cls: 'pm-table-cell-assignees' });
    for (const a of task.assignees.slice(0, 3)) {
      const av = assigneesCell.createEl('span', { cls: 'pm-avatar pm-avatar--sm' });
      av.textContent = a.slice(0, 2).toUpperCase();
      av.title = a;
      av.style.background = stringToColor(a);
    }
    if (task.assignees.length > 3) {
      assigneesCell.createEl('span', {
        text: `+${task.assignees.length - 3}`,
        cls: 'pm-avatar pm-avatar--sm pm-avatar--more',
      });
    }

    // Due date cell
    const dueCell = row.createEl('td', { cls: 'pm-table-cell-due' });
    if (task.due) {
      const overdue = isTaskOverdue(task, this.plugin.settings.statuses);
      const chip = dueCell.createEl('span', { text: formatDateShort(task.due), cls: 'pm-due-chip' });
      if (overdue) chip.addClass('pm-due-chip--overdue');
    }

    // Progress cell
    const progressCell = row.createEl('td', { cls: 'pm-table-cell-progress' });
    const pbar = progressCell.createDiv('pm-progress-bar');
    const pfill = pbar.createDiv('pm-progress-bar-fill');
    pfill.style.width = `${task.progress}%`;
    pfill.style.background = project.color;
    progressCell.createEl('span', { text: `${task.progress}%`, cls: 'pm-progress-text' });

    // Time cell
    const timeCell = row.createEl('td', { cls: 'pm-table-cell-time' });
    const logged = totalLoggedHours(task);
    const est = task.timeEstimate ?? 0;
    if (logged > 0 || est > 0) {
      const chip = timeCell.createEl('span', { cls: 'pm-time-chip' });
      chip.setText(est > 0 ? `${logged}/${est}h` : `${logged}h`);
      if (est > 0 && logged > est) chip.addClass('pm-time-chip--over');
    }

    // Actions cell
    const actionsCell = row.createEl('td', { cls: 'pm-table-cell-actions' });
    const actBtn = actionsCell.createEl('button', { cls: 'pm-icon-btn', attr: { 'aria-label': 'Task actions' } });
    actBtn.setText('⋮');
    actBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = new Menu();
      buildTaskContextMenu(menu, task, { plugin: this.plugin, project, onRefresh: this.onRefreshAll });
      menu.showAtMouseEvent(e);
    });

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const menu = new Menu();
      buildTaskContextMenu(menu, task, { plugin: this.plugin, project, onRefresh: this.onRefreshAll });
      menu.showAtMouseEvent(e);
    });
  }
}

function priorityOrder(p: string): number {
  return ({ critical: 0, high: 1, medium: 2, low: 3 } as Record<string, number>)[p] ?? 99;
}

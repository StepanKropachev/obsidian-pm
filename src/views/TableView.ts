import { Menu } from 'obsidian';
import type PMPlugin from '../main';
import {
  Project, Task, FlatTask, flattenTasks, findTask, TaskStatus, TaskPriority,
  totalLoggedHours, FilterState, SavedView, DueDateFilter,
  makeTask, addTaskToTree, makeId, makeDefaultFilter, deleteTaskFromTree,
} from '../types';
import { TaskModal } from '../modals/TaskModal';
import { stringToColor, formatDateLong, todayMidnight, isTaskOverdue } from '../utils';
import { renderStatusBadge, renderPriorityBadge } from '../ui/StatusBadge';
import { renderFilterDropdown } from '../ui/FilterDropdown';
import type { SubView } from './SubView';

type SortKey = 'title' | 'status' | 'priority' | 'due' | 'assignees' | 'progress';
type SortDir = 'asc' | 'desc';

export class TableView implements SubView {
  private sortKey: SortKey = 'status';
  private sortDir: SortDir = 'asc';
  private filter: FilterState = makeDefaultFilter();
  private selectedTaskId: string | null = null;
  private activeSavedViewId: string | null = null;

  constructor(
    private container: HTMLElement,
    private project: Project,
    private plugin: PMPlugin,
    private onRefresh: () => Promise<void>,
  ) {}

  render(): void {
    this.container.empty();
    this.container.addClass('pm-table-view');

    this.renderQuickAdd();
    this.renderSavedViewsBar();
    this.renderFilterBar();
    this.renderTable();
  }

  // ─── Quick-Add ──────────────────────────────────────────────────────────────

  private renderQuickAdd(): void {
    const bar = this.container.createDiv('pm-quick-add');
    const input = bar.createEl('input', {
      type: 'text',
      placeholder: 'Quick add task… (press Enter)',
      cls: 'pm-quick-add-input',
    });
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const title = input.value.trim();
        if (!title) return;
        const task = makeTask({ title });
        addTaskToTree(this.project.tasks, task, null);
        await this.plugin.store.saveProject(this.project);
        input.value = '';
        await this.onRefresh();
      } else if (e.key === 'Escape') {
        input.value = '';
        input.blur();
      }
    });
  }

  /** Focus the quick-add input (called from keyboard shortcut) */
  focusQuickAdd(): void {
    const input = this.container.querySelector('.pm-quick-add-input') as HTMLInputElement | null;
    if (input) { input.focus(); input.select(); }
  }

  // ─── Saved Views Bar ───────────────────────────────────────────────────────

  private renderSavedViewsBar(): void {
    if (!this.project.savedViews.length && !this.hasActiveFilters()) return;

    const bar = this.container.createDiv('pm-saved-views-bar');

    // "All" pill
    const allPill = bar.createEl('button', { text: 'All', cls: 'pm-saved-view-pill' });
    if (!this.activeSavedViewId) allPill.addClass('pm-saved-view-pill--active');
    allPill.addEventListener('click', () => {
      this.activeSavedViewId = null;
      this.filter = makeDefaultFilter();
      this.sortKey = 'status';
      this.sortDir = 'asc';
      this.render();
    });

    for (const sv of this.project.savedViews) {
      const pill = bar.createEl('button', { text: sv.name, cls: 'pm-saved-view-pill' });
      if (this.activeSavedViewId === sv.id) pill.addClass('pm-saved-view-pill--active');
      pill.addEventListener('click', () => {
        this.activeSavedViewId = sv.id;
        this.filter = { ...sv.filter };
        this.sortKey = sv.sortKey as SortKey;
        this.sortDir = sv.sortDir;
        this.render();
      });
      pill.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const menu = new Menu();
        menu.addItem(item => item.setTitle('Update with current filters').setIcon('refresh-cw').onClick(async () => {
          sv.filter = { ...this.filter };
          sv.sortKey = this.sortKey;
          sv.sortDir = this.sortDir;
          await this.plugin.store.saveProject(this.project);
          this.render();
        }));
        menu.addItem(item => item.setTitle('Delete view').setIcon('trash').onClick(async () => {
          this.project.savedViews = this.project.savedViews.filter(v => v.id !== sv.id);
          if (this.activeSavedViewId === sv.id) this.activeSavedViewId = null;
          await this.plugin.store.saveProject(this.project);
          this.render();
        }));
        menu.showAtMouseEvent(e as MouseEvent);
      });
    }

    // "+ Save View" button (show when filters are active)
    if (this.hasActiveFilters()) {
      const saveBtn = bar.createEl('button', { text: '+ Save View', cls: 'pm-saved-view-pill pm-saved-view-pill--save' });
      saveBtn.addEventListener('click', async () => {
        const name = prompt('View name:');
        if (!name?.trim()) return;
        const sv: SavedView = {
          id: makeId(),
          name: name.trim(),
          filter: { ...this.filter },
          sortKey: this.sortKey,
          sortDir: this.sortDir,
        };
        this.project.savedViews.push(sv);
        this.activeSavedViewId = sv.id;
        await this.plugin.store.saveProject(this.project);
        this.render();
      });
    }
  }

  private hasActiveFilters(): boolean {
    const f = this.filter;
    return !!(f.text || f.statuses.length || f.priorities.length || f.assignees.length || f.tags.length || f.dueDateFilter !== 'any');
  }

  // ─── Filter Bar ─────────────────────────────────────────────────────────────

  private renderFilterBar(): void {
    const bar = this.container.createDiv('pm-filter-bar');

    // Text search
    const search = bar.createEl('input', {
      type: 'text',
      placeholder: '🔍 Search tasks…',
      cls: 'pm-filter-input',
    });
    search.value = this.filter.text;
    search.addEventListener('input', () => {
      this.filter.text = search.value;
      this.refreshTable();
    });

    // Status filter button
    this.renderFilterDropdownBtn(bar, 'Status', this.filter.statuses,
      this.plugin.settings.statuses.map(s => ({ id: s.id, label: `${s.icon} ${s.label}` })),
      (selected) => { this.filter.statuses = selected as TaskStatus[]; this.refreshTable(); });

    // Priority filter button
    this.renderFilterDropdownBtn(bar, 'Priority', this.filter.priorities,
      this.plugin.settings.priorities.map(p => ({ id: p.id, label: `${p.icon} ${p.label}` })),
      (selected) => { this.filter.priorities = selected as TaskPriority[]; this.refreshTable(); });

    // Assignee filter button
    const allAssignees = this.getAllAssignees();
    if (allAssignees.length) {
      this.renderFilterDropdownBtn(bar, 'Assignee', this.filter.assignees,
        allAssignees.map(a => ({ id: a, label: a })),
        (selected) => { this.filter.assignees = selected; this.refreshTable(); });
    }

    // Tag filter button
    const allTags = this.getAllTags();
    if (allTags.length) {
      this.renderFilterDropdownBtn(bar, 'Tag', this.filter.tags,
        allTags.map(t => ({ id: t, label: t })),
        (selected) => { this.filter.tags = selected; this.refreshTable(); });
    }

    // Due date filter button
    this.renderDueDateFilter(bar);

    // Active filter indicators
    const activeCount = this.countActiveFilters();
    if (activeCount > 0) {
      const clearBtn = bar.createEl('button', { text: `✕ Clear (${activeCount})`, cls: 'pm-btn pm-btn-ghost pm-btn-sm' });
      clearBtn.addEventListener('click', () => {
        this.filter = makeDefaultFilter();
        this.activeSavedViewId = null;
        this.render();
      });
    }
  }

  private renderFilterDropdownBtn(
    parent: HTMLElement,
    label: string,
    selected: string[],
    options: { id: string; label: string }[],
    onChange: (selected: string[]) => void,
  ): void {
    renderFilterDropdown(parent, label, selected, options, onChange);
  }

  private renderDueDateFilter(parent: HTMLElement): void {
    const current = this.filter.dueDateFilter;
    const labels: Record<DueDateFilter, string> = {
      'any': 'Due Date',
      'overdue': 'Overdue',
      'this-week': 'This Week',
      'this-month': 'This Month',
      'no-date': 'No Date',
    };
    const btn = parent.createEl('button', {
      text: current !== 'any' ? `Due: ${labels[current]}` : 'Due Date',
      cls: 'pm-filter-dropdown-btn',
    });
    if (current !== 'any') btn.addClass('pm-filter-dropdown-btn--active');

    btn.addEventListener('click', (e) => {
      const menu = new Menu();
      const opts: DueDateFilter[] = ['any', 'overdue', 'this-week', 'this-month', 'no-date'];
      for (const opt of opts) {
        menu.addItem(item => item
          .setTitle(labels[opt])
          .setChecked(current === opt)
          .onClick(() => {
            this.filter.dueDateFilter = opt;
            this.refreshTable();
          }));
      }
      menu.showAtMouseEvent(e as MouseEvent);
    });
  }

  private countActiveFilters(): number {
    let count = 0;
    if (this.filter.text) count++;
    if (this.filter.statuses.length) count++;
    if (this.filter.priorities.length) count++;
    if (this.filter.assignees.length) count++;
    if (this.filter.tags.length) count++;
    if (this.filter.dueDateFilter !== 'any') count++;
    return count;
  }

  private getAllAssignees(): string[] {
    const set = new Set<string>();
    const collect = (tasks: Task[]) => {
      for (const t of tasks) {
        for (const a of t.assignees) set.add(a);
        collect(t.subtasks);
      }
    };
    collect(this.project.tasks);
    return [...set].sort();
  }

  private getAllTags(): string[] {
    const set = new Set<string>();
    const collect = (tasks: Task[]) => {
      for (const t of tasks) {
        for (const tag of t.tags) set.add(tag);
        collect(t.subtasks);
      }
    };
    collect(this.project.tasks);
    return [...set].sort();
  }

  // ─── Table ──────────────────────────────────────────────────────────────────

  private tableBody: HTMLElement | null = null;

  private renderTable(): void {
    const wrapper = this.container.createDiv('pm-table-wrapper');
    const table = wrapper.createEl('table', { cls: 'pm-table' });

    // Header
    const thead = table.createEl('thead');
    const hrow = thead.createEl('tr');
    const cols: { key: SortKey | null; label: string; width?: string }[] = [
      { key: null,        label: '',          width: '32px'  },
      { key: 'title',     label: 'Task',      width: 'auto'  },
      { key: 'status',    label: 'Status',    width: '130px' },
      { key: 'priority',  label: 'Priority',  width: '110px' },
      { key: 'assignees', label: 'Assignees', width: '140px' },
      { key: 'due',       label: 'Due',       width: '110px' },
      { key: 'progress',  label: 'Progress',  width: '120px' },
      { key: null,        label: 'Time',      width: '90px'  },
      { key: null,        label: '',          width: '40px'  },
    ];
    for (const col of cols) {
      const th = hrow.createEl('th');
      if (col.width) th.style.width = col.width;
      if (col.key) {
        th.addClass('pm-table-th-sortable');
        th.createEl('span', { text: col.label });
        if (this.sortKey === col.key) {
          th.createEl('span', {
            text: this.sortDir === 'asc' ? ' ↑' : ' ↓',
            cls: 'pm-sort-indicator',
          });
        }
        th.addEventListener('click', () => {
          if (this.sortKey === col.key) {
            this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            this.sortKey = col.key as SortKey;
            this.sortDir = 'asc';
          }
          this.refreshTable();
        });
      } else {
        th.setText(col.label);
      }
    }

    for (const cf of this.project.customFields) {
      const th = hrow.createEl('th', { text: cf.name });
      th.style.width = '120px';
    }

    this.tableBody = table.createEl('tbody');
    this.fillTableBody();
  }

  private refreshTable(): void {
    if (this.tableBody) {
      this.fillTableBody();
    } else {
      this.render();
    }
  }

  private fillTableBody(): void {
    if (!this.tableBody) return;
    this.tableBody.empty();

    let flat = flattenTasks(this.project.tasks);

    // Apply filters
    flat = this.applyFilters(flat);

    // Sort
    const topLevel = flat.filter(f => f.parentId === null);
    topLevel.sort((a, b) => this.compareTask(a.task, b.task));
    const sorted: FlatTask[] = [];
    const addWithChildren = (parentId: string | null) => {
      const items = flat.filter(f => f.parentId === parentId);
      items.sort((a, b) => this.compareTask(a.task, b.task));
      for (const item of items) {
        sorted.push(item);
        addWithChildren(item.task.id);
      }
    };
    addWithChildren(null);

    for (const { task, depth, parentId, visible } of sorted) {
      if (!visible) continue;
      this.renderTaskRow(this.tableBody, task, depth, parentId);
    }

    // "Add task" row
    const addRow = this.tableBody.createEl('tr', { cls: 'pm-table-add-row' });
    const addCell = addRow.createEl('td', { attr: { colspan: String(9 + this.project.customFields.length) } });
    const addBtn = addCell.createEl('button', { text: '+ Add Task', cls: 'pm-table-add-btn' });
    addBtn.addEventListener('click', async () => {
      new TaskModal(this.app, this.plugin, this.project, null, null, async () => {
        await this.onRefresh();
      }).open();
    });
  }

  private applyFilters(flat: FlatTask[]): FlatTask[] {
    const f = this.filter;
    return flat.filter(({ task }) => {
      // Text search
      if (f.text) {
        const q = f.text.toLowerCase();
        if (!(task.title.toLowerCase().includes(q) ||
              task.status.includes(q) ||
              task.priority.includes(q) ||
              task.assignees.some(a => a.toLowerCase().includes(q)) ||
              task.tags.some(t => t.toLowerCase().includes(q)))) return false;
      }
      // Status filter
      if (f.statuses.length && !f.statuses.includes(task.status)) return false;
      // Priority filter
      if (f.priorities.length && !f.priorities.includes(task.priority)) return false;
      // Assignee filter
      if (f.assignees.length && !task.assignees.some(a => f.assignees.includes(a))) return false;
      // Tag filter
      if (f.tags.length && !task.tags.some(t => f.tags.includes(t))) return false;
      // Due date filter
      if (f.dueDateFilter !== 'any') {
        if (!this.matchDueDateFilter(task, f.dueDateFilter)) return false;
      }
      return true;
    });
  }

  private matchDueDateFilter(task: Task, filter: DueDateFilter): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    switch (filter) {
      case 'no-date':
        return !task.due;
      case 'overdue': {
        if (!task.due) return false;
        const d = new Date(task.due);
        return d < today && task.status !== 'done' && task.status !== 'cancelled';
      }
      case 'this-week': {
        if (!task.due) return false;
        const d = new Date(task.due);
        const endOfWeek = new Date(today);
        const dayOfWeek = today.getDay();
        endOfWeek.setDate(today.getDate() + (7 - dayOfWeek));
        return d >= today && d <= endOfWeek;
      }
      case 'this-month': {
        if (!task.due) return false;
        const d = new Date(task.due);
        return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear() && d >= today;
      }
      default:
        return true;
    }
  }

  private get app() { return this.plugin.app; }

  // ─── Keyboard handling ──────────────────────────────────────────────────────

  handleKeyDown(e: KeyboardEvent): void {
    const active = document.activeElement;
    const isInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ||
                    (active instanceof HTMLElement && active.contentEditable === 'true');

    if (e.key === 'Escape') {
      if (isInput) {
        (active as HTMLElement).blur();
        return;
      }
      this.selectedTaskId = null;
      this.updateSelectedRow();
      return;
    }

    if (isInput) return;

    const rows = this.getVisibleTaskIds();
    if (!rows.length) return;

    switch (e.key) {
      case 'ArrowDown':
      case 'j': {
        e.preventDefault();
        const idx = this.selectedTaskId ? rows.indexOf(this.selectedTaskId) : -1;
        const next = Math.min(idx + 1, rows.length - 1);
        this.selectedTaskId = rows[next];
        this.updateSelectedRow();
        break;
      }
      case 'ArrowUp':
      case 'k': {
        e.preventDefault();
        const idx = this.selectedTaskId ? rows.indexOf(this.selectedTaskId) : rows.length;
        const prev = Math.max(idx - 1, 0);
        this.selectedTaskId = rows[prev];
        this.updateSelectedRow();
        break;
      }
      case 'Enter':
      case 'e': {
        if (!this.selectedTaskId) return;
        e.preventDefault();
        const task = findTask(this.project.tasks, this.selectedTaskId);
        if (task) {
          new TaskModal(this.app, this.plugin, this.project, task, null, async () => {
            await this.onRefresh();
          }).open();
        }
        break;
      }
      case 'n':
      case 'N': {
        e.preventDefault();
        this.focusQuickAdd();
        break;
      }
      case 'Delete':
      case 'Backspace': {
        if (!this.selectedTaskId) return;
        e.preventDefault();
        const id = this.selectedTaskId;
        // Move selection to next/prev row
        const currentIdx = rows.indexOf(id);
        const nextIdx = currentIdx < rows.length - 1 ? currentIdx + 1 : currentIdx - 1;
        this.selectedTaskId = nextIdx >= 0 ? rows[nextIdx] : null;
        this.deleteTask(id);
        break;
      }
    }
  }

  private getVisibleTaskIds(): string[] {
    if (!this.tableBody) return [];
    const rows = this.tableBody.querySelectorAll('tr[data-task-id]');
    return Array.from(rows).map(r => (r as HTMLElement).dataset.taskId!);
  }

  private updateSelectedRow(): void {
    if (!this.tableBody) return;
    this.tableBody.querySelectorAll('.pm-table-row--selected').forEach(r => r.removeClass('pm-table-row--selected'));
    if (this.selectedTaskId) {
      const row = this.tableBody.querySelector(`tr[data-task-id="${this.selectedTaskId}"]`);
      if (row) {
        row.addClass('pm-table-row--selected');
        (row as HTMLElement).scrollIntoView({ block: 'nearest' });
      }
    }
  }

  private async deleteTask(id: string): Promise<void> {
    deleteTaskFromTree(this.project.tasks, id);
    await this.plugin.store.saveProject(this.project);
    await this.onRefresh();
  }

  // ─── Row rendering ─────────────────────────────────────────────────────────

  private renderTaskRow(tbody: HTMLElement, task: Task, depth: number, parentId: string | null): void {
    const statusConfig = this.plugin.settings.statuses.find(s => s.id === task.status);
    const priorityConfig = this.plugin.settings.priorities.find(p => p.id === task.priority);
    const isDone = task.status === 'done' || task.status === 'cancelled';

    const row = tbody.createEl('tr', { cls: 'pm-table-row' });
    row.dataset.taskId = task.id;
    if (isDone) row.addClass('pm-table-row--done');
    if (this.selectedTaskId === task.id) row.addClass('pm-table-row--selected');
    row.style.setProperty('--depth', String(depth));

    // Click row to select
    row.addEventListener('click', (e) => {
      // Don't select when clicking interactive elements
      const target = e.target as HTMLElement;
      if (target.closest('button, input, .pm-status-badge, .pm-priority-badge, .pm-task-title-text')) return;
      this.selectedTaskId = task.id;
      this.updateSelectedRow();
    });

    // ── Expand toggle
    const expandCell = row.createEl('td', { cls: 'pm-table-cell-expand' });
    if (task.subtasks.length > 0) {
      const btn = expandCell.createEl('button', {
        text: task.collapsed ? '▶' : '▼',
        cls: 'pm-expand-btn',
      });
      btn.addEventListener('click', async () => {
        await this.plugin.store.updateTask(this.project, task.id, { collapsed: !task.collapsed });
        await this.onRefresh();
      });
    }

    // ── Title
    const titleCell = row.createEl('td', { cls: 'pm-table-cell-title' });
    titleCell.style.paddingLeft = `${depth * 20 + 8}px`;

    const checkbox = titleCell.createEl('input', { type: 'checkbox', cls: 'pm-task-checkbox' });
    checkbox.checked = task.status === 'done';
    checkbox.addEventListener('change', async () => {
      await this.plugin.store.updateTask(this.project, task.id, {
        status: checkbox.checked ? 'done' : 'todo',
        progress: checkbox.checked ? 100 : 0,
      });
      await this.onRefresh();
    });

    const titleSpan = titleCell.createEl('span', { text: task.title, cls: 'pm-task-title-text' });
    titleSpan.addEventListener('click', async () => {
      new TaskModal(this.app, this.plugin, this.project, task, null, async () => {
        await this.onRefresh();
      }).open();
    });
    titleSpan.addEventListener('dblclick', e => {
      e.stopPropagation();
      const input = titleCell.createEl('input', { type: 'text', cls: 'pm-inline-edit', value: task.title });
      titleSpan.replaceWith(input);
      input.focus(); input.select();
      const save = async () => {
        const val = input.value.trim();
        if (val && val !== task.title) {
          await this.plugin.store.updateTask(this.project, task.id, { title: val });
          await this.onRefresh();
        } else {
          input.replaceWith(titleSpan);
        }
      };
      input.addEventListener('blur', save);
      input.addEventListener('keydown', ev => { if (ev.key === 'Enter') save(); if (ev.key === 'Escape') input.replaceWith(titleSpan); });
    });

    if (task.type === 'milestone') titleCell.createEl('span', { text: 'M', cls: 'pm-task-badge pm-task-badge--milestone', attr: { title: 'Milestone' } });
    if (task.type === 'subtask') titleCell.createEl('span', { text: 'Sub', cls: 'pm-task-badge pm-task-badge--subtask', attr: { title: 'Subtask' } });
    if (task.recurrence) titleCell.createEl('span', { text: 'R', cls: 'pm-task-badge pm-task-badge--recurrence', attr: { title: 'Recurring' } });

    if (task.tags.length) {
      const tagRow = titleCell.createDiv('pm-table-tags');
      for (const tag of task.tags) {
        tagRow.createEl('span', { text: tag, cls: 'pm-tag' });
      }
    }

    // ── Status
    const statusCell = row.createEl('td', { cls: 'pm-table-cell' });
    if (statusConfig) {
      renderStatusBadge(statusCell, task, this.plugin.settings.statuses, async (status) => {
        await this.plugin.store.updateTask(this.project, task.id, { status });
        await this.onRefresh();
      });
    }

    // ── Priority
    const prioCell = row.createEl('td', { cls: 'pm-table-cell' });
    if (priorityConfig) {
      renderPriorityBadge(prioCell, task, this.plugin.settings.priorities, async (priority) => {
        await this.plugin.store.updateTask(this.project, task.id, { priority });
        await this.onRefresh();
      });
    }

    // ── Assignees
    const assigneesCell = row.createEl('td', { cls: 'pm-table-cell pm-table-cell-assignees' });
    for (const a of task.assignees.slice(0, 3)) {
      const avatar = assigneesCell.createEl('span', { cls: 'pm-avatar' });
      avatar.textContent = a.slice(0, 2).toUpperCase();
      avatar.title = a;
      avatar.style.background = stringToColor(a);
    }
    if (task.assignees.length > 3) {
      assigneesCell.createEl('span', {
        text: `+${task.assignees.length - 3}`,
        cls: 'pm-avatar pm-avatar-more',
      });
    }

    // ── Due date
    const dueCell = row.createEl('td', { cls: 'pm-table-cell' });
    if (task.due) {
      const dueDate = new Date(task.due);
      const today = todayMidnight();
      const overdue = isTaskOverdue(task);
      const isNear = !overdue && (dueDate.getTime() - today.getTime()) < 3 * 86400_000;
      const chip = dueCell.createEl('span', {
        text: formatDateLong(task.due),
        cls: 'pm-due-chip',
      });
      if (overdue) chip.addClass('pm-due-chip--overdue');
      else if (isNear) chip.addClass('pm-due-chip--near');
      chip.addEventListener('dblclick', e => {
        e.stopPropagation();
        const input = dueCell.createEl('input', { type: 'date', cls: 'pm-inline-edit', value: task.due });
        chip.replaceWith(input);
        input.focus();
        const save = async () => {
          if (input.value !== task.due) {
            await this.plugin.store.updateTask(this.project, task.id, { due: input.value });
            await this.onRefresh();
          } else input.replaceWith(chip);
        };
        input.addEventListener('blur', save);
        input.addEventListener('change', save);
      });
    }

    // ── Progress
    const progressCell = row.createEl('td', { cls: 'pm-table-cell pm-table-cell-progress' });
    const progressWrap = progressCell.createDiv('pm-progress-wrap');
    const progressBar = progressWrap.createDiv('pm-progress-bar');
    const progressFill = progressBar.createDiv('pm-progress-fill');
    progressFill.style.width = `${task.progress}%`;
    progressFill.style.background = statusConfig?.color ?? '#6366f1';
    progressWrap.createEl('span', { text: `${task.progress}%`, cls: 'pm-progress-label' });

    // ── Time tracking
    const timeCell = row.createEl('td', { cls: 'pm-table-cell pm-table-cell-time' });
    const logged = totalLoggedHours(task);
    const est = task.timeEstimate ?? 0;
    if (logged > 0 || est > 0) {
      const timeChip = timeCell.createEl('span', { cls: 'pm-time-chip' });
      timeChip.setText(est > 0 ? `${logged}/${est}h` : `${logged}h`);
      if (est > 0 && logged > est) timeChip.addClass('pm-time-chip--over');
    }

    // ── Actions
    const actionsCell = row.createEl('td', { cls: 'pm-table-cell pm-table-cell-actions' });
    const actionsMenu = actionsCell.createEl('button', { text: '⋯', cls: 'pm-row-menu-btn' });
    actionsMenu.addEventListener('click', e => {
      const menu = new Menu();
      menu.addItem(item => item.setTitle('Edit task').setIcon('pencil').onClick(async () => {
        new TaskModal(this.app, this.plugin, this.project, task, null, async () => {
          await this.onRefresh();
        }).open();
      }));
      menu.addItem(item => item.setTitle('Add subtask').setIcon('plus').onClick(async () => {
        new TaskModal(this.app, this.plugin, this.project, null, task.id, async () => {
          await this.onRefresh();
        }).open();
      }));
      menu.addSeparator();
      menu.addItem(item => item.setTitle('Delete task').setIcon('trash').onClick(async () => {
        await this.plugin.store.deleteTask(this.project, task.id);
        await this.onRefresh();
      }));
      menu.showAtMouseEvent(e as MouseEvent);
    });

    // ── Custom fields
    for (const cf of this.project.customFields) {
      const cfCell = row.createEl('td', { cls: 'pm-table-cell' });
      const val = task.customFields[cf.id];
      cfCell.createEl('span', { text: val !== undefined ? String(val) : '—', cls: 'pm-cf-value' });
    }
  }

  // ─── Utilities ──────────────────────────────────────────────────────────────

  private compareTask(a: Task, b: Task): number {
    const dir = this.sortDir === 'asc' ? 1 : -1;
    switch (this.sortKey) {
      case 'title':     return dir * a.title.localeCompare(b.title);
      case 'status':    return dir * this.statusOrder(a.status) - dir * this.statusOrder(b.status);
      case 'priority':  return dir * this.priorityOrder(a.priority) - dir * this.priorityOrder(b.priority);
      case 'due':       return dir * (a.due || 'zzz').localeCompare(b.due || 'zzz');
      case 'assignees': return dir * (a.assignees[0] ?? '').localeCompare(b.assignees[0] ?? '');
      case 'progress':  return dir * (a.progress - b.progress);
      default:          return 0;
    }
  }

  private statusOrder(s: TaskStatus): number {
    return { 'in-progress': 0, 'blocked': 1, 'review': 2, 'todo': 3, 'done': 4, 'cancelled': 5 }[s] ?? 99;
  }

  private priorityOrder(p: TaskPriority): number {
    return { critical: 0, high: 1, medium: 2, low: 3 }[p] ?? 99;
  }

}

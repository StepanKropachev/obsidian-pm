import { Menu } from 'obsidian';
import type PMPlugin from '../../main';
import type { Project, Task, FilterState, TaskStatus, TaskPriority, DueDateFilter } from '../../types';
import { type FlatTask, flattenTasks, findTask, totalLoggedHours, deleteTaskFromTree } from '../../store/TaskTreeOps';
import { stringToColor, formatDateLong, todayMidnight, isTaskOverdue } from '../../utils';
import { COLOR_ACCENT } from '../../constants';
import { renderStatusBadge, renderPriorityBadge } from '../../ui/StatusBadge';
import { openTaskModal } from '../../ui/ModalFactory';
import { focusQuickAdd } from './QuickAddBar';

type SortKey = 'title' | 'status' | 'priority' | 'due' | 'assignees' | 'progress';
type SortDir = 'asc' | 'desc';

export type { SortKey, SortDir };

export interface TableState {
  sortKey: SortKey;
  sortDir: SortDir;
  filter: FilterState;
  selectedTaskId: string | null;
  tableBody: HTMLElement | null;
}

export interface TableContext {
  container: HTMLElement;
  project: Project;
  plugin: PMPlugin;
  state: TableState;
  onRefresh: () => Promise<void>;
}

export function renderTable(ctx: TableContext): void {
  const wrapper = ctx.container.createDiv('pm-table-wrapper');
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
      th.setAttribute('role', 'button');
      th.setAttribute('aria-label', `Sort by ${col.label}`);
      th.createEl('span', { text: col.label });
      if (ctx.state.sortKey === col.key) {
        th.createEl('span', {
          text: ctx.state.sortDir === 'asc' ? ' ↑' : ' ↓',
          cls: 'pm-sort-indicator',
        });
      }
      th.addEventListener('click', () => {
        if (ctx.state.sortKey === col.key) {
          ctx.state.sortDir = ctx.state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          ctx.state.sortKey = col.key as SortKey;
          ctx.state.sortDir = 'asc';
        }
        refreshTableBody(ctx);
      });
    } else {
      th.setText(col.label);
    }
  }

  for (const cf of ctx.project.customFields) {
    const th = hrow.createEl('th', { text: cf.name });
    th.style.width = '120px';
  }

  ctx.state.tableBody = table.createEl('tbody');
  fillTableBody(ctx);
}

export function refreshTableBody(ctx: TableContext): void {
  if (ctx.state.tableBody) {
    fillTableBody(ctx);
  }
}

function fillTableBody(ctx: TableContext): void {
  const tbody = ctx.state.tableBody;
  if (!tbody) return;
  tbody.empty();

  let flat = flattenTasks(ctx.project.tasks);
  flat = applyFilters(flat, ctx.state.filter);

  // Sort with hierarchy
  const sorted: FlatTask[] = [];
  const addWithChildren = (parentId: string | null) => {
    const items = flat.filter(f => f.parentId === parentId);
    items.sort((a, b) => compareTask(a.task, b.task, ctx.state));
    for (const item of items) {
      sorted.push(item);
      addWithChildren(item.task.id);
    }
  };
  addWithChildren(null);

  for (const { task, depth, parentId, visible } of sorted) {
    if (!visible) continue;
    renderTaskRow(tbody, task, depth, parentId, ctx);
  }

  // "Add task" row
  const addRow = tbody.createEl('tr', { cls: 'pm-table-add-row' });
  const addCell = addRow.createEl('td', { attr: { colspan: String(9 + ctx.project.customFields.length) } });
  const addBtn = addCell.createEl('button', { text: '+ Add Task', cls: 'pm-table-add-btn' });
  addBtn.addEventListener('click', async () => {
    openTaskModal(ctx.plugin, ctx.project, { onSave: async () => { await ctx.onRefresh(); } });
  });
}

function applyFilters(flat: FlatTask[], filter: FilterState): FlatTask[] {
  return flat.filter(({ task }) => {
    if (filter.text) {
      const q = filter.text.toLowerCase();
      if (!(task.title.toLowerCase().includes(q) ||
            task.status.includes(q) ||
            task.priority.includes(q) ||
            task.assignees.some(a => a.toLowerCase().includes(q)) ||
            task.tags.some(t => t.toLowerCase().includes(q)))) return false;
    }
    if (filter.statuses.length && !filter.statuses.includes(task.status)) return false;
    if (filter.priorities.length && !filter.priorities.includes(task.priority)) return false;
    if (filter.assignees.length && !task.assignees.some(a => filter.assignees.includes(a))) return false;
    if (filter.tags.length && !task.tags.some(t => filter.tags.includes(t))) return false;
    if (filter.dueDateFilter !== 'any') {
      if (!matchDueDateFilter(task, filter.dueDateFilter)) return false;
    }
    return true;
  });
}

function matchDueDateFilter(task: Task, filter: DueDateFilter): boolean {
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

function compareTask(a: Task, b: Task, state: TableState): number {
  const dir = state.sortDir === 'asc' ? 1 : -1;
  switch (state.sortKey) {
    case 'title':     return dir * a.title.localeCompare(b.title);
    case 'status':    return dir * statusOrder(a.status) - dir * statusOrder(b.status);
    case 'priority':  return dir * priorityOrder(a.priority) - dir * priorityOrder(b.priority);
    case 'due':       return dir * (a.due || 'zzz').localeCompare(b.due || 'zzz');
    case 'assignees': return dir * (a.assignees[0] ?? '').localeCompare(b.assignees[0] ?? '');
    case 'progress':  return dir * (a.progress - b.progress);
    default:          return 0;
  }
}

function statusOrder(s: TaskStatus): number {
  return { 'in-progress': 0, 'blocked': 1, 'review': 2, 'todo': 3, 'done': 4, 'cancelled': 5 }[s] ?? 99;
}

function priorityOrder(p: TaskPriority): number {
  return { critical: 0, high: 1, medium: 2, low: 3 }[p] ?? 99;
}

// ─── Row rendering ─────────────────────────────────────────────────────────

function renderTaskRow(tbody: HTMLElement, task: Task, depth: number, _parentId: string | null, ctx: TableContext): void {
  const statusConfig = ctx.plugin.settings.statuses.find(s => s.id === task.status);
  const priorityConfig = ctx.plugin.settings.priorities.find(p => p.id === task.priority);
  const isDone = task.status === 'done' || task.status === 'cancelled';

  const row = tbody.createEl('tr', { cls: 'pm-table-row' });
  row.dataset.taskId = task.id;
  if (isDone) row.addClass('pm-table-row--done');
  if (ctx.state.selectedTaskId === task.id) row.addClass('pm-table-row--selected');
  row.style.setProperty('--depth', String(depth));

  row.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, input, .pm-status-badge, .pm-priority-badge, .pm-task-title-text')) return;
    ctx.state.selectedTaskId = task.id;
    updateSelectedRow(ctx.state);
  });

  // ── Expand toggle
  const expandCell = row.createEl('td', { cls: 'pm-table-cell-expand' });
  if (task.subtasks.length > 0) {
    const btn = expandCell.createEl('button', {
      text: task.collapsed ? '▶' : '▼',
      cls: 'pm-expand-btn',
      attr: { 'aria-label': task.collapsed ? 'Expand subtasks' : 'Collapse subtasks' },
    });
    btn.addEventListener('click', async () => {
      await ctx.plugin.store.updateTask(ctx.project, task.id, { collapsed: !task.collapsed });
      await ctx.onRefresh();
    });
  }

  // ── Title
  const titleCell = row.createEl('td', { cls: 'pm-table-cell-title' });
  titleCell.style.paddingLeft = `${depth * 20 + 8}px`;

  const checkbox = titleCell.createEl('input', { type: 'checkbox', cls: 'pm-task-checkbox' });
  checkbox.checked = task.status === 'done';
  checkbox.addEventListener('change', async () => {
    await ctx.plugin.store.updateTask(ctx.project, task.id, {
      status: checkbox.checked ? 'done' : 'todo',
      progress: checkbox.checked ? 100 : 0,
    });
    await ctx.onRefresh();
  });

  const titleSpan = titleCell.createEl('span', { text: task.title, cls: 'pm-task-title-text' });
  titleSpan.addEventListener('click', async () => {
    openTaskModal(ctx.plugin, ctx.project, { task, onSave: async () => { await ctx.onRefresh(); } });
  });
  titleSpan.addEventListener('dblclick', e => {
    e.stopPropagation();
    const input = titleCell.createEl('input', { type: 'text', cls: 'pm-inline-edit', value: task.title });
    titleSpan.replaceWith(input);
    input.focus(); input.select();
    const save = async () => {
      const val = input.value.trim();
      if (val && val !== task.title) {
        await ctx.plugin.store.updateTask(ctx.project, task.id, { title: val });
        await ctx.onRefresh();
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
    renderStatusBadge(statusCell, task, ctx.plugin.settings.statuses, async (status) => {
      await ctx.plugin.store.updateTask(ctx.project, task.id, { status });
      await ctx.onRefresh();
    });
  }

  // ── Priority
  const prioCell = row.createEl('td', { cls: 'pm-table-cell' });
  if (priorityConfig) {
    renderPriorityBadge(prioCell, task, ctx.plugin.settings.priorities, async (priority) => {
      await ctx.plugin.store.updateTask(ctx.project, task.id, { priority });
      await ctx.onRefresh();
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
          await ctx.plugin.store.updateTask(ctx.project, task.id, { due: input.value });
          await ctx.onRefresh();
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
  progressFill.style.background = statusConfig?.color ?? COLOR_ACCENT;
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
  const actionsMenu = actionsCell.createEl('button', { text: '⋯', cls: 'pm-row-menu-btn', attr: { 'aria-label': 'Task actions' } });
  actionsMenu.addEventListener('click', e => {
    const menu = new Menu();
    menu.addItem(item => item.setTitle('Edit task').setIcon('pencil').onClick(async () => {
      openTaskModal(ctx.plugin, ctx.project, { task, onSave: async () => { await ctx.onRefresh(); } });
    }));
    menu.addItem(item => item.setTitle('Add subtask').setIcon('plus').onClick(async () => {
      openTaskModal(ctx.plugin, ctx.project, { parentId: task.id, onSave: async () => { await ctx.onRefresh(); } });
    }));
    menu.addSeparator();
    menu.addItem(item => item.setTitle('Delete task').setIcon('trash').onClick(async () => {
      await ctx.plugin.store.deleteTask(ctx.project, task.id);
      await ctx.onRefresh();
    }));
    menu.showAtMouseEvent(e as MouseEvent);
  });

  // ── Custom fields
  for (const cf of ctx.project.customFields) {
    const cfCell = row.createEl('td', { cls: 'pm-table-cell' });
    const val = task.customFields[cf.id];
    cfCell.createEl('span', { text: val !== undefined ? String(val) : '—', cls: 'pm-cf-value' });
  }
}

// ─── Keyboard handling ──────────────────────────────────────────────────────

export function handleTableKeyDown(e: KeyboardEvent, ctx: TableContext): void {
  const active = document.activeElement;
  const isInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ||
                  (active instanceof HTMLElement && active.contentEditable === 'true');

  if (e.key === 'Escape') {
    if (isInput) {
      (active as HTMLElement).blur();
      return;
    }
    ctx.state.selectedTaskId = null;
    updateSelectedRow(ctx.state);
    return;
  }

  if (isInput) return;

  const rows = getVisibleTaskIds(ctx.state);
  if (!rows.length) return;

  switch (e.key) {
    case 'ArrowDown':
    case 'j': {
      e.preventDefault();
      const idx = ctx.state.selectedTaskId ? rows.indexOf(ctx.state.selectedTaskId) : -1;
      const next = Math.min(idx + 1, rows.length - 1);
      ctx.state.selectedTaskId = rows[next];
      updateSelectedRow(ctx.state);
      break;
    }
    case 'ArrowUp':
    case 'k': {
      e.preventDefault();
      const idx = ctx.state.selectedTaskId ? rows.indexOf(ctx.state.selectedTaskId) : rows.length;
      const prev = Math.max(idx - 1, 0);
      ctx.state.selectedTaskId = rows[prev];
      updateSelectedRow(ctx.state);
      break;
    }
    case 'Enter':
    case 'e': {
      if (!ctx.state.selectedTaskId) return;
      e.preventDefault();
      const task = findTask(ctx.project.tasks, ctx.state.selectedTaskId);
      if (task) {
        openTaskModal(ctx.plugin, ctx.project, { task, onSave: async () => { await ctx.onRefresh(); } });
      }
      break;
    }
    case 'n':
    case 'N': {
      e.preventDefault();
      focusQuickAdd(ctx.container);
      break;
    }
    case 'Delete':
    case 'Backspace': {
      if (!ctx.state.selectedTaskId) return;
      e.preventDefault();
      const id = ctx.state.selectedTaskId;
      const currentIdx = rows.indexOf(id);
      const nextIdx = currentIdx < rows.length - 1 ? currentIdx + 1 : currentIdx - 1;
      ctx.state.selectedTaskId = nextIdx >= 0 ? rows[nextIdx] : null;
      deleteTask(id, ctx);
      break;
    }
  }
}

function getVisibleTaskIds(state: TableState): string[] {
  if (!state.tableBody) return [];
  const rows = state.tableBody.querySelectorAll('tr[data-task-id]');
  return Array.from(rows).map(r => (r as HTMLElement).dataset.taskId!);
}

function updateSelectedRow(state: TableState): void {
  if (!state.tableBody) return;
  state.tableBody.querySelectorAll('.pm-table-row--selected').forEach(r => r.removeClass('pm-table-row--selected'));
  if (state.selectedTaskId) {
    const row = state.tableBody.querySelector(`tr[data-task-id="${state.selectedTaskId}"]`);
    if (row) {
      row.addClass('pm-table-row--selected');
      (row as HTMLElement).scrollIntoView({ block: 'nearest' });
    }
  }
}

async function deleteTask(id: string, ctx: TableContext): Promise<void> {
  deleteTaskFromTree(ctx.project.tasks, id);
  await ctx.plugin.store.saveProject(ctx.project);
  await ctx.onRefresh();
}

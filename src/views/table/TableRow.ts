import { Menu, Notice } from 'obsidian';
import type { Task, Project } from '../../types';
import { totalLoggedHours } from '../../store/TaskTreeOps';
import { stringToColor, formatDateLong, todayMidnight, isTaskOverdue, getStatusConfig, getPriorityConfig } from '../../utils';
import { COLOR_ACCENT } from '../../constants';
import { renderStatusBadge, renderPriorityBadge } from '../../ui/StatusBadge';
import { openTaskModal } from '../../ui/ModalFactory';
import type { TableContext, TableState } from './TableRenderer';

// ─── Inline edit helper ────────────────────────────────────────────────────────

interface InlineEditOpts {
  container: HTMLElement;
  display: HTMLElement;
  inputType: 'text' | 'date';
  value: string;
  onSave: (newValue: string) => Promise<void>;
}

function makeInlineEdit(opts: InlineEditOpts): void {
  const { container, display, inputType, value, onSave } = opts;
  const input = container.createEl('input', { type: inputType, cls: 'pm-inline-edit', value });
  display.replaceWith(input);
  input.focus();
  if (inputType === 'text') input.select();

  let saved = false;
  const save = async () => {
    if (saved) return;
    saved = true;
    const newVal = input.value.trim();
    if (newVal !== value) {
      await onSave(newVal);
    } else {
      input.replaceWith(display);
    }
  };

  input.addEventListener('blur', save);
  if (inputType === 'text') {
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') save();
      if (ev.key === 'Escape') input.replaceWith(display);
    });
  } else {
    input.addEventListener('change', save);
  }
}

// ─── Cell renderers ────────────────────────────────────────────────────────────

function renderSelectCell(row: HTMLElement, task: Task, ctx: TableContext): void {
  const cell = row.createEl('td', { cls: 'pm-table-cell-select' });
  const cb = cell.createEl('input', { type: 'checkbox', cls: 'pm-select-checkbox' });
  cb.checked = ctx.state.selectedTaskIds.has(task.id);
  cb.addEventListener('change', (e) => {
    e.stopPropagation();
    if (cb.checked) {
      ctx.state.selectedTaskIds.add(task.id);
    } else {
      ctx.state.selectedTaskIds.delete(task.id);
    }
    updateSelectAllCheckbox(ctx.state);
    ctx.onSelectionChange();
  });
  cb.addEventListener('click', (e) => e.stopPropagation());
}

function renderExpandCell(row: HTMLElement, task: Task, ctx: TableContext): void {
  const cell = row.createEl('td', { cls: 'pm-table-cell-expand' });
  if (task.subtasks.length > 0) {
    const btn = cell.createEl('button', {
      text: task.collapsed ? '\u25b6' : '\u25bc',
      cls: 'pm-expand-btn',
      attr: { 'aria-label': task.collapsed ? 'Expand subtasks' : 'Collapse subtasks' },
    });
    btn.addEventListener('click', async () => {
      await ctx.plugin.store.updateTask(ctx.project, task.id, { collapsed: !task.collapsed });
      await ctx.onRefresh();
    });
  }
}

function renderTitleCell(row: HTMLElement, task: Task, depth: number, ctx: TableContext): void {
  const cell = row.createEl('td', { cls: 'pm-table-cell-title' });
  cell.style.paddingLeft = `${depth * 20 + 8}px`;

  // Title text (click to open, dblclick to inline edit)
  const titleSpan = cell.createEl('span', { text: task.title, cls: 'pm-task-title-text' });
  titleSpan.addEventListener('click', async () => {
    openTaskModal(ctx.plugin, ctx.project, { task, onSave: async () => { await ctx.onRefresh(); } });
  });
  titleSpan.addEventListener('dblclick', e => {
    e.stopPropagation();
    makeInlineEdit({
      container: cell,
      display: titleSpan,
      inputType: 'text',
      value: task.title,
      onSave: async (val) => {
        await ctx.plugin.store.updateTask(ctx.project, task.id, { title: val });
        await ctx.onRefresh();
      },
    });
  });

  // Add subtask button
  const addSubtaskBtn = cell.createEl('button', {
    cls: 'pm-add-subtask-btn',
    attr: { 'aria-label': 'Add subtask', title: 'Add subtask' },
  });
  addSubtaskBtn.setText('+');
  addSubtaskBtn.addEventListener('click', e => {
    e.stopPropagation();
    openTaskModal(ctx.plugin, ctx.project, { parentId: task.id, onSave: async () => { await ctx.onRefresh(); } });
  });

  // Type badges
  if (task.type === 'milestone') cell.createEl('span', { text: 'M', cls: 'pm-task-badge pm-task-badge--milestone', attr: { title: 'Milestone' } });
  if (task.type === 'subtask') cell.createEl('span', { text: 'Sub', cls: 'pm-task-badge pm-task-badge--subtask', attr: { title: 'Subtask' } });
  if (task.recurrence) cell.createEl('span', { text: 'R', cls: 'pm-task-badge pm-task-badge--recurrence', attr: { title: 'Recurring' } });
  if (task.archived) cell.createEl('span', { text: 'Archived', cls: 'pm-task-badge pm-task-badge--archived', attr: { title: 'Archived' } });

  // Tags
  if (task.tags.length) {
    const tagRow = cell.createDiv('pm-table-tags');
    for (const tag of task.tags) {
      tagRow.createEl('span', { text: tag, cls: 'pm-tag' });
    }
  }
}

function renderStatusCell(row: HTMLElement, task: Task, ctx: TableContext): void {
  const cell = row.createEl('td', { cls: 'pm-table-cell' });
  const statusConfig = getStatusConfig(ctx.plugin.settings.statuses, task.status);
  if (statusConfig) {
    renderStatusBadge(cell, task, ctx.plugin.settings.statuses, async (status) => {
      await ctx.plugin.store.updateTask(ctx.project, task.id, { status });
      await ctx.onRefresh();
    });
  }
}

function renderPriorityCell(row: HTMLElement, task: Task, ctx: TableContext): void {
  const cell = row.createEl('td', { cls: 'pm-table-cell' });
  const priorityConfig = getPriorityConfig(ctx.plugin.settings.priorities, task.priority);
  if (priorityConfig) {
    renderPriorityBadge(cell, task, ctx.plugin.settings.priorities, async (priority) => {
      await ctx.plugin.store.updateTask(ctx.project, task.id, { priority });
      await ctx.onRefresh();
    });
  }
}

function renderAssigneesCell(row: HTMLElement, task: Task): void {
  const cell = row.createEl('td', { cls: 'pm-table-cell pm-table-cell-assignees' });
  for (const a of task.assignees.slice(0, 3)) {
    const avatar = cell.createEl('span', { cls: 'pm-avatar' });
    avatar.textContent = a.slice(0, 2).toUpperCase();
    avatar.title = a;
    avatar.style.background = stringToColor(a);
  }
  if (task.assignees.length > 3) {
    cell.createEl('span', {
      text: `+${task.assignees.length - 3}`,
      cls: 'pm-avatar pm-avatar-more',
    });
  }
}

function startDueDateEdit(cell: HTMLElement, display: HTMLElement, task: Task, ctx: TableContext): void {
  makeInlineEdit({
    container: cell,
    display,
    inputType: 'date',
    value: task.due,
    onSave: async (val) => {
      await ctx.plugin.store.updateTask(ctx.project, task.id, { due: val });
      await ctx.onRefresh();
    },
  });
}

function renderDueDateCell(row: HTMLElement, task: Task, ctx: TableContext): void {
  const cell = row.createEl('td', { cls: 'pm-table-cell' });

  if (!task.due) {
    const placeholder = cell.createEl('span', { text: '\u2014', cls: 'pm-due-placeholder' });
    placeholder.addEventListener('click', e => {
      e.stopPropagation();
      startDueDateEdit(cell, placeholder, task, ctx);
    });
    return;
  }

  const dueDate = new Date(task.due);
  const today = todayMidnight();
  const overdue = isTaskOverdue(task);
  const isNear = !overdue && (dueDate.getTime() - today.getTime()) < 3 * 86400_000;

  const chip = cell.createEl('span', {
    text: formatDateLong(task.due),
    cls: 'pm-due-chip',
  });
  if (overdue) chip.addClass('pm-due-chip--overdue');
  else if (isNear) chip.addClass('pm-due-chip--near');

  chip.addEventListener('click', e => {
    e.stopPropagation();
    startDueDateEdit(cell, chip, task, ctx);
  });
}

function renderProgressCell(row: HTMLElement, task: Task, statusColor: string | undefined): void {
  const cell = row.createEl('td', { cls: 'pm-table-cell pm-table-cell-progress' });
  const wrap = cell.createDiv('pm-progress-wrap');
  const bar = wrap.createDiv('pm-progress-bar');
  const fill = bar.createDiv('pm-progress-fill');
  fill.style.width = `${task.progress}%`;
  fill.style.background = statusColor ?? COLOR_ACCENT;
  wrap.createEl('span', { text: `${task.progress}%`, cls: 'pm-progress-label' });
}

function renderTimeCell(row: HTMLElement, task: Task): void {
  const cell = row.createEl('td', { cls: 'pm-table-cell pm-table-cell-time' });
  const logged = totalLoggedHours(task);
  const est = task.timeEstimate ?? 0;
  if (logged > 0 || est > 0) {
    const chip = cell.createEl('span', { cls: 'pm-time-chip' });
    chip.setText(est > 0 ? `${logged}/${est}h` : `${logged}h`);
    if (est > 0 && logged > est) chip.addClass('pm-time-chip--over');
  }
}

function renderActionsCell(row: HTMLElement, task: Task, ctx: TableContext): void {
  const cell = row.createEl('td', { cls: 'pm-table-cell pm-table-cell-actions' });
  const btn = cell.createEl('button', { text: '\u22ef', cls: 'pm-row-menu-btn', attr: { 'aria-label': 'Task actions' } });
  btn.addEventListener('click', e => {
    const menu = new Menu();
    menu.addItem(item => item.setTitle('Edit task').setIcon('pencil').onClick(async () => {
      openTaskModal(ctx.plugin, ctx.project, { task, onSave: async () => { await ctx.onRefresh(); } });
    }));
    menu.addItem(item => item.setTitle('Add subtask').setIcon('plus').onClick(async () => {
      openTaskModal(ctx.plugin, ctx.project, { parentId: task.id, onSave: async () => { await ctx.onRefresh(); } });
    }));
    menu.addSeparator();
    if (task.archived) {
      menu.addItem(item => item.setTitle('Unarchive').setIcon('archive-restore').onClick(async () => {
        await ctx.plugin.store.unarchiveTask(ctx.project, task.id);
        new Notice('Task unarchived');
        await ctx.onRefresh();
      }));
    } else {
      menu.addItem(item => item.setTitle('Archive').setIcon('archive').onClick(async () => {
        await ctx.plugin.store.archiveTask(ctx.project, task.id);
        new Notice('Task archived');
        await ctx.onRefresh();
      }));
    }
    menu.addItem(item => item.setTitle('Delete task').setIcon('trash').onClick(async () => {
      await ctx.plugin.store.deleteTask(ctx.project, task.id);
      await ctx.onRefresh();
    }));
    menu.showAtMouseEvent(e as MouseEvent);
  });
}

function renderCustomFieldCells(row: HTMLElement, task: Task, project: Project): void {
  for (const cf of project.customFields) {
    const cell = row.createEl('td', { cls: 'pm-table-cell' });
    const val = task.customFields[cf.id];
    cell.createEl('span', { text: val !== undefined ? String(val) : '\u2014', cls: 'pm-cf-value' });
  }
}

// ─── Row orchestrator ──────────────────────────────────────────────────────────

export function renderTaskRow(tbody: HTMLElement, task: Task, depth: number, _parentId: string | null, ctx: TableContext): void {
  const isDone = task.status === 'done' || task.status === 'cancelled';
  const statusConfig = getStatusConfig(ctx.plugin.settings.statuses, task.status);

  const row = tbody.createEl('tr', { cls: 'pm-table-row' });
  row.dataset.taskId = task.id;
  if (isDone) row.addClass('pm-table-row--done');
  if (task.archived) row.addClass('pm-table-row--archived');
  if (ctx.state.selectedTaskId === task.id) row.addClass('pm-table-row--selected');
  row.style.setProperty('--depth', String(depth));

  row.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, input, .pm-status-badge, .pm-priority-badge, .pm-task-title-text, .pm-due-chip, .pm-due-placeholder, .pm-table-cell-select')) return;
    ctx.state.selectedTaskId = task.id;
    updateSelectedRow(ctx.state);
  });

  renderSelectCell(row, task, ctx);
  renderExpandCell(row, task, ctx);
  renderTitleCell(row, task, depth, ctx);
  renderStatusCell(row, task, ctx);
  renderPriorityCell(row, task, ctx);
  renderAssigneesCell(row, task);
  renderDueDateCell(row, task, ctx);
  renderProgressCell(row, task, statusConfig?.color);
  renderTimeCell(row, task);
  renderActionsCell(row, task, ctx);
  renderCustomFieldCells(row, task, ctx.project);
}

// ─── Selection ─────────────────────────────────────────────────────────────────

export function updateSelectAllCheckbox(state: TableState): void {
  if (!state.tableBody) return;
  const wrapper = state.tableBody.closest('.pm-table-wrapper');
  if (!wrapper) return;
  const selectAllCb = wrapper.querySelector('.pm-select-all-checkbox') as HTMLInputElement | null;
  if (!selectAllCb) return;
  const ids = Array.from(state.tableBody.querySelectorAll('tr[data-task-id]')).map(r => (r as HTMLElement).dataset.taskId!);
  if (ids.length === 0) {
    selectAllCb.checked = false;
    selectAllCb.indeterminate = false;
  } else if (ids.every(id => state.selectedTaskIds.has(id))) {
    selectAllCb.checked = true;
    selectAllCb.indeterminate = false;
  } else if (ids.some(id => state.selectedTaskIds.has(id))) {
    selectAllCb.checked = false;
    selectAllCb.indeterminate = true;
  } else {
    selectAllCb.checked = false;
    selectAllCb.indeterminate = false;
  }
}

export function updateSelectedRow(state: TableState): void {
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

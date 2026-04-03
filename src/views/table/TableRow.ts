import { Menu } from 'obsidian';
import type { Task } from '../../types';
import { totalLoggedHours } from '../../store/TaskTreeOps';
import { stringToColor, formatDateLong, todayMidnight, isTaskOverdue } from '../../utils';
import { COLOR_ACCENT } from '../../constants';
import { renderStatusBadge, renderPriorityBadge } from '../../ui/StatusBadge';
import { openTaskModal } from '../../ui/ModalFactory';
import type { TableContext, TableState } from './TableRenderer';

export function renderTaskRow(tbody: HTMLElement, task: Task, depth: number, _parentId: string | null, ctx: TableContext): void {
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
      text: task.collapsed ? '\u25b6' : '\u25bc',
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

  const addSubtaskBtn = titleCell.createEl('button', {
    cls: 'pm-add-subtask-btn',
    attr: { 'aria-label': 'Add subtask', title: 'Add subtask' },
  });
  addSubtaskBtn.setText('+');
  addSubtaskBtn.addEventListener('click', e => {
    e.stopPropagation();
    openTaskModal(ctx.plugin, ctx.project, { parentId: task.id, onSave: async () => { await ctx.onRefresh(); } });
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
  const actionsMenu = actionsCell.createEl('button', { text: '\u22ef', cls: 'pm-row-menu-btn', attr: { 'aria-label': 'Task actions' } });
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
    cfCell.createEl('span', { text: val !== undefined ? String(val) : '\u2014', cls: 'pm-cf-value' });
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

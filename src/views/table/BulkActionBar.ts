import { Menu } from 'obsidian';
import type { Task, TaskStatus, TaskPriority } from '../../types';
import { findTask } from '../../store/TaskTreeOps';
import { formatBadgeText } from '../../utils';
import type { TableContext } from './TableRenderer';
import { updateSelectAllCheckbox } from './TableRow';

export type BulkAction =
  | { type: 'set-status'; status: TaskStatus }
  | { type: 'set-priority'; priority: TaskPriority }
  | { type: 'set-assignee'; assignee: string }
  | { type: 'set-tag'; tag: string }
  | { type: 'set-due-date'; due: string }
  | { type: 'set-progress'; progress: number }
  | { type: 'archive' }
  | { type: 'unarchive' }
  | { type: 'delete' };

export interface BulkActionBarOpts {
  ctx: TableContext;
  onAction: (action: BulkAction) => void;
}

/**
 * Render or update the bulk action bar.
 * Shows when selectedTaskIds.size > 0, hidden otherwise.
 */
export function renderBulkActionBar(opts: BulkActionBarOpts): void {
  const { ctx, onAction } = opts;
  const existing = ctx.container.querySelector('.pm-bulk-bar') as HTMLElement | null;

  if (ctx.state.selectedTaskIds.size === 0) {
    existing?.remove();
    return;
  }

  // Reuse existing bar or create a new one
  const bar = existing ?? createBar(ctx.container);
  updateBarContent(bar, ctx, onAction);
}

function createBar(container: HTMLElement): HTMLElement {
  const bar = createDiv({ cls: 'pm-bulk-bar' });
  // Insert after quick-add bar (first child) or at the top
  const quickAdd = container.querySelector('.pm-quick-add');
  if (quickAdd?.nextSibling) {
    container.insertBefore(bar, quickAdd.nextSibling);
  } else if (quickAdd) {
    container.appendChild(bar);
  } else {
    container.prepend(bar);
  }
  return bar;
}

function updateBarContent(bar: HTMLElement, ctx: TableContext, onAction: (a: BulkAction) => void): void {
  bar.empty();
  const count = ctx.state.selectedTaskIds.size;

  // Left section: count + actions
  const left = bar.createDiv('pm-bulk-bar-left');
  left.createEl('span', { text: `${count} selected`, cls: 'pm-bulk-bar-count' });

  // Status button
  const statusBtn = left.createEl('button', { text: 'Set Status', cls: 'pm-btn pm-btn-ghost pm-btn-sm' });
  statusBtn.addEventListener('click', (e) => {
    const menu = new Menu();
    for (const s of ctx.plugin.settings.statuses) {
      menu.addItem(item => item
        .setTitle(formatBadgeText(s.icon, s.label))
        .onClick(() => onAction({ type: 'set-status', status: s.id as TaskStatus })));
    }
    menu.showAtMouseEvent(e as MouseEvent);
  });

  // Priority button
  const priorityBtn = left.createEl('button', { text: 'Set Priority', cls: 'pm-btn pm-btn-ghost pm-btn-sm' });
  priorityBtn.addEventListener('click', (e) => {
    const menu = new Menu();
    for (const p of ctx.plugin.settings.priorities) {
      menu.addItem(item => item
        .setTitle(formatBadgeText(p.icon, p.label))
        .onClick(() => onAction({ type: 'set-priority', priority: p.id as TaskPriority })));
    }
    menu.showAtMouseEvent(e as MouseEvent);
  });

  // Assignee button
  const assigneeBtn = left.createEl('button', { text: 'Set Assignee', cls: 'pm-btn pm-btn-ghost pm-btn-sm' });
  assigneeBtn.addEventListener('click', (e) => {
    const menu = new Menu();
    const allMembers = collectMembers(ctx);
    for (const m of allMembers) {
      menu.addItem(item => item.setTitle(m).onClick(() => onAction({ type: 'set-assignee', assignee: m })));
    }
    menu.addSeparator();
    menu.addItem(item => item.setTitle('+ New assignee...').onClick(() => {
      const name = prompt('Enter assignee name:');
      if (name?.trim()) onAction({ type: 'set-assignee', assignee: name.trim() });
    }));
    menu.addSeparator();
    menu.addItem(item => item.setTitle('Clear assignees').onClick(() => onAction({ type: 'set-assignee', assignee: '' })));
    menu.showAtMouseEvent(e as MouseEvent);
  });

  // Tag button
  const tagBtn = left.createEl('button', { text: 'Set Tag', cls: 'pm-btn pm-btn-ghost pm-btn-sm' });
  tagBtn.addEventListener('click', (e) => {
    const menu = new Menu();
    const allTags = collectTags(ctx);
    for (const t of allTags) {
      menu.addItem(item => item.setTitle(t).onClick(() => onAction({ type: 'set-tag', tag: t })));
    }
    menu.addSeparator();
    menu.addItem(item => item.setTitle('+ New tag...').onClick(() => {
      const tag = prompt('Enter tag:');
      if (tag?.trim()) onAction({ type: 'set-tag', tag: tag.trim() });
    }));
    menu.addSeparator();
    menu.addItem(item => item.setTitle('Clear tags').onClick(() => onAction({ type: 'set-tag', tag: '' })));
    menu.showAtMouseEvent(e as MouseEvent);
  });

  // Due Date button
  const dueBtn = left.createEl('button', { text: 'Set Due Date', cls: 'pm-btn pm-btn-ghost pm-btn-sm' });
  dueBtn.addEventListener('click', (e) => {
    const menu = new Menu();
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const addDays = (days: number) => { const d = new Date(today); d.setDate(d.getDate() + days); return d; };
    menu.addItem(item => item.setTitle(`Today (${fmt(today)})`).onClick(() => onAction({ type: 'set-due-date', due: fmt(today) })));
    menu.addItem(item => item.setTitle(`Tomorrow (${fmt(addDays(1))})`).onClick(() => onAction({ type: 'set-due-date', due: fmt(addDays(1)) })));
    menu.addItem(item => item.setTitle(`In 1 week (${fmt(addDays(7))})`).onClick(() => onAction({ type: 'set-due-date', due: fmt(addDays(7)) })));
    menu.addItem(item => item.setTitle(`In 2 weeks (${fmt(addDays(14))})`).onClick(() => onAction({ type: 'set-due-date', due: fmt(addDays(14)) })));
    menu.addSeparator();
    menu.addItem(item => item.setTitle('Pick date...').onClick(() => {
      const input = document.createElement('input');
      input.type = 'date';
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        if (input.value) onAction({ type: 'set-due-date', due: input.value });
        input.remove();
      });
      input.addEventListener('blur', () => setTimeout(() => input.remove(), 200));
      input.showPicker();
    }));
    menu.addSeparator();
    menu.addItem(item => item.setTitle('Clear due date').onClick(() => onAction({ type: 'set-due-date', due: '' })));
    menu.showAtMouseEvent(e as MouseEvent);
  });

  // Progress button
  const progressBtn = left.createEl('button', { text: 'Set Progress', cls: 'pm-btn pm-btn-ghost pm-btn-sm' });
  progressBtn.addEventListener('click', (e) => {
    const menu = new Menu();
    for (const pct of [0, 25, 50, 75, 100]) {
      menu.addItem(item => item.setTitle(`${pct}%`).onClick(() => onAction({ type: 'set-progress', progress: pct })));
    }
    menu.showAtMouseEvent(e as MouseEvent);
  });

  // Archive / Unarchive button — show based on selected tasks' state
  const selectedIds = [...ctx.state.selectedTaskIds];
  const selectedTasks = selectedIds.map(id => findTask(ctx.project.tasks, id)).filter(Boolean) as Task[];
  const hasArchived = selectedTasks.some(t => t.archived);
  const hasNonArchived = selectedTasks.some(t => !t.archived);

  if (hasNonArchived) {
    const archiveBtn = left.createEl('button', { text: 'Archive', cls: 'pm-btn pm-btn-ghost pm-btn-sm' });
    archiveBtn.addEventListener('click', () => onAction({ type: 'archive' }));
  }
  if (hasArchived) {
    const unarchiveBtn = left.createEl('button', { text: 'Unarchive', cls: 'pm-btn pm-btn-ghost pm-btn-sm' });
    unarchiveBtn.addEventListener('click', () => onAction({ type: 'unarchive' }));
  }

  // Delete button
  const deleteBtn = left.createEl('button', { text: 'Delete', cls: 'pm-btn pm-btn-danger pm-btn-sm' });
  deleteBtn.addEventListener('click', () => {
    onAction({ type: 'delete' });
  });

  // Right section: clear selection
  const right = bar.createDiv('pm-bulk-bar-right');
  const clearBtn = right.createEl('button', { cls: 'pm-btn pm-btn-ghost pm-btn-icon pm-btn-sm', attr: { 'aria-label': 'Clear selection' } });
  clearBtn.setText('\u00d7');
  clearBtn.addEventListener('click', () => {
    ctx.state.selectedTaskIds.clear();
    // Update row checkboxes
    if (ctx.state.tableBody) {
      const cbs = ctx.state.tableBody.querySelectorAll('.pm-select-checkbox') as NodeListOf<HTMLInputElement>;
      cbs.forEach(cb => cb.checked = false);
    }
    updateSelectAllCheckbox(ctx.state);
    renderBulkActionBar({ ctx, onAction });
  });
}

function collectMembers(ctx: TableContext): string[] {
  const set = new Set<string>();
  for (const m of ctx.project.teamMembers) set.add(m);
  for (const m of ctx.plugin.settings.globalTeamMembers) set.add(m);
  const collect = (tasks: Task[]) => {
    for (const t of tasks) {
      for (const a of t.assignees) set.add(a);
      collect(t.subtasks);
    }
  };
  collect(ctx.project.tasks);
  return [...set].filter(Boolean).sort();
}

function collectTags(ctx: TableContext): string[] {
  const set = new Set<string>();
  const collect = (tasks: Task[]) => {
    for (const t of tasks) {
      for (const tag of t.tags) set.add(tag);
      collect(t.subtasks);
    }
  };
  collect(ctx.project.tasks);
  return [...set].filter(Boolean).sort();
}

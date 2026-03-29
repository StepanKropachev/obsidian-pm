import { Menu } from 'obsidian';
import type { Task, TaskStatus, TaskPriority, StatusConfig, PriorityConfig } from '../types';
import { COLOR_MUTED, COLOR_MUTED_ALT } from '../constants';

/**
 * Render a clickable status badge that opens a menu to change the status.
 */
export function renderStatusBadge(
  container: HTMLElement,
  task: Task,
  statuses: StatusConfig[],
  onChange: (status: TaskStatus) => void,
): HTMLElement {
  const config = statuses.find(s => s.id === task.status);
  const badge = container.createEl('span', {
    text: `${config?.icon ?? ''} ${config?.label ?? task.status}`,
    cls: 'pm-status-badge',
  });
  badge.style.setProperty('--badge-color', config?.color ?? COLOR_MUTED);
  badge.addEventListener('click', e => {
    const menu = new Menu();
    for (const s of statuses) {
      menu.addItem(item => item
        .setTitle(`${s.icon} ${s.label}`)
        .setChecked(s.id === task.status)
        .onClick(() => onChange(s.id as TaskStatus)));
    }
    menu.showAtMouseEvent(e as MouseEvent);
  });
  return badge;
}

/**
 * Render a clickable priority badge that opens a menu to change the priority.
 */
export function renderPriorityBadge(
  container: HTMLElement,
  task: Task,
  priorities: PriorityConfig[],
  onChange: (priority: TaskPriority) => void,
): HTMLElement {
  const config = priorities.find(p => p.id === task.priority);
  const badge = container.createEl('span', {
    text: `${config?.icon ?? ''} ${config?.label ?? task.priority}`,
    cls: 'pm-priority-badge',
  });
  badge.style.setProperty('--badge-color', config?.color ?? COLOR_MUTED_ALT);
  badge.addEventListener('click', e => {
    const menu = new Menu();
    for (const p of priorities) {
      menu.addItem(item => item
        .setTitle(`${p.icon} ${p.label}`)
        .setChecked(p.id === task.priority)
        .onClick(() => onChange(p.id as TaskPriority)));
    }
    menu.showAtMouseEvent(e as MouseEvent);
  });
  return badge;
}

/**
 * Render a simple status dot (colored circle).
 */
export function renderStatusDot(
  container: HTMLElement,
  status: TaskStatus,
  statuses: StatusConfig[],
  cls = 'pm-subtask-dot',
): HTMLElement {
  const config = statuses.find(s => s.id === status);
  const dot = container.createEl('span', { cls });
  dot.style.background = config?.color ?? COLOR_MUTED;
  return dot;
}

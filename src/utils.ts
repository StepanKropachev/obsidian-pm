import { Notice } from 'obsidian';
import type { Task, StatusConfig, PriorityConfig, TaskStatus, TaskPriority } from './types';

/** Deterministic HSL color from a string (e.g. assignee name) */
export function stringToColor(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 55%, 45%)`;
}

/** Short date: "Mar 28" */
export function formatDateShort(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Long date: "Mar 28, '26" */
export function formatDateLong(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
}

/** Today at midnight (00:00:00.000) */
export function todayMidnight(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Is a task overdue? (past due, not done/cancelled) */
export function isTaskOverdue(task: Task): boolean {
  if (!task.due) return false;
  const dueDate = new Date(task.due);
  return dueDate < todayMidnight() && task.status !== 'done' && task.status !== 'cancelled';
}

/** Is a task due within `days` days from today? (not overdue) */
export function isTaskDueSoon(task: Task, days: number): boolean {
  if (!task.due) return false;
  if (task.status === 'done' || task.status === 'cancelled') return false;
  const today = todayMidnight();
  const dueDate = new Date(task.due);
  dueDate.setHours(0, 0, 0, 0);
  return dueDate >= today && dueDate.getTime() <= today.getTime() + days * 86400_000;
}

/** Safely convert a custom-field value to a display string.
 *  Arrays are joined with ", "; objects fall back to '' to avoid [object Object]. */
export function stringifyCustomValue(val: unknown): string {
  if (val === undefined || val === null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) return val.map(v => String(v)).join(', ');
  return '';
}

/** Truncate a title for display (e.g. tab header) */
export function truncateTitle(title: string, maxLen = 20): string {
  if (title.length <= maxLen) return title;
  return title.slice(0, maxLen - 1) + '…';
}

/** Replace characters illegal in file names */
export function sanitizeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '-');
}

/** Look up a status config by id */
export function getStatusConfig(statuses: StatusConfig[], id: TaskStatus): StatusConfig | undefined {
  return statuses.find(s => s.id === id);
}

/** Look up a priority config by id */
export function getPriorityConfig(priorities: PriorityConfig[], id: TaskPriority): PriorityConfig | undefined {
  return priorities.find(p => p.id === id);
}

/** Format a config's icon + label into display text (e.g. "🔴 Critical") */
export function formatBadgeText(icon: string | undefined, label: string): string {
  return [icon, label].filter(Boolean).join(' ');
}

/** Wrap an async callback so unhandled rejections show a Notice and log to console */
export function safeAsync<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => void {
  return (...args: A) => {
    fn(...args).catch((err: unknown) => {
      console.error('[PM]', err);
      new Notice('Something went wrong. Check the console for details.');
    });
  };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an SVG element with attributes in one call */
export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, String(v));
    }
  }
  return el;
}

import { Notice } from 'obsidian'
import type { Task, StatusConfig, PriorityConfig, TaskPriority } from './types'
import { today, parsePlainDate, Temporal } from './dates'

/** Deterministic HSL color from a string (e.g. assignee name) */
export function stringToColor(s: string): string {
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash)
  return `hsl(${Math.abs(hash) % 360}, 55%, 45%)`
}

/** Short date: "Mar 28" */
export function formatDateShort(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Long date: "Mar 28, '26" */
export function formatDateLong(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
}

/** Is a status marked as terminal (complete) in the config? */
export function isTerminalStatus(status: string, statuses: StatusConfig[]): boolean {
  const cfg = statuses.find((s) => s.id === status)
  return cfg ? cfg.complete : false
}

/** Returns the default status id (first in the list) */
export function getDefaultStatusId(statuses: StatusConfig[]): string {
  return statuses.length > 0 ? statuses[0].id : 'todo'
}

/** Returns the first status id marked as complete */
export function getCompleteStatusId(statuses: StatusConfig[]): string {
  const found = statuses.find((s) => s.complete)
  return found ? found.id : 'done'
}

/** Returns the sort index of a status in the config array (999 for unknown) */
export function statusSortOrder(status: string, statuses: StatusConfig[]): number {
  const idx = statuses.findIndex((s) => s.id === status)
  return idx >= 0 ? idx : 999
}

/** Is a task overdue? (past due, not in a terminal status) */
export function isTaskOverdue(task: Task, statuses: StatusConfig[]): boolean {
  const due = parsePlainDate(task.due)
  if (!due) return false
  return Temporal.PlainDate.compare(due, today()) < 0 && !isTerminalStatus(task.status, statuses)
}

/** Safely convert a custom-field value to a display string.
 *  Arrays are joined with ", "; objects fall back to '' to avoid [object Object]. */
export function stringifyCustomValue(val: unknown): string {
  if (val === undefined || val === null) return ''
  if (typeof val === 'string') return val
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  if (Array.isArray(val)) return val.map((v) => String(v)).join(', ')
  return ''
}

/** Truncate a title for display (e.g. tab header) */
export function truncateTitle(title: string, maxLen = 20): string {
  if (title.length <= maxLen) return title
  return title.slice(0, maxLen - 1) + '…'
}

/** Replace characters illegal in file names */
export function sanitizeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '-')
}

/** Look up a status config by id */
export function getStatusConfig(statuses: StatusConfig[], id: string): StatusConfig | undefined {
  return statuses.find((s) => s.id === id)
}

/** Look up a priority config by id */
export function getPriorityConfig(priorities: PriorityConfig[], id: TaskPriority): PriorityConfig | undefined {
  return priorities.find((p) => p.id === id)
}

/** Format a config's icon + label into display text (e.g. "🔴 Critical") */
export function formatBadgeText(icon: string | undefined, label: string): string {
  return [icon, label].filter(Boolean).join(' ')
}

/** Wrap an async callback so unhandled rejections show a Notice and log to console */
export function safeAsync<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => void {
  return (...args: A) => {
    fn(...args).catch((err: unknown) => {
      console.error('[PM]', err)
      new Notice('Something went wrong. Check the console for details.')
    })
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Create an SVG element with attributes in one call */
export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const el = activeDocument.createElementNS(SVG_NS, tag)
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, String(v))
    }
  }
  return el
}

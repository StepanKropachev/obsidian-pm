import { Notice, parseLinktext, setIcon } from 'obsidian'
import type { Task, StatusConfig, PriorityConfig, TaskPriority, PriorityIconSet } from './types'
import { PRIORITY_ICON_SETS } from './types'
import type { DueUrgency } from './ui/composites/dueChip'
import { today, parsePlainDate } from './dates'

export function displayName(raw: string): string {
  // Values come from frontmatter, where anything YAML allows can turn up in a list of names.
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  const m = trimmed.match(/^\[\[([^\]]+)\]\]$/)
  if (!m) return trimmed
  const inner = m[1]
  const pipe = inner.indexOf('|')
  if (pipe >= 0) {
    const alias = inner.slice(pipe + 1).trim()
    if (alias) return alias
  }
  const target = pipe >= 0 ? inner.slice(0, pipe) : inner
  const { path } = parseLinktext(target)
  const base = path.split('/').pop() ?? path
  return (base.endsWith('.md') ? base.slice(0, -3) : base).trim()
}

/**
 * One entry per person, keeping the wikilink spelling so the vault link is preserved.
 * `keyOf` decides who counts as the same person; pass `personKeyer(app)` to tell two people
 * with the same name apart by the notes they point at.
 */
export function dedupePeople(values: string[], keyOf: (raw: string) => string = displayName): string[] {
  const byKey = new Map<string, string>()
  for (const value of values) {
    if (!value) continue
    const key = keyOf(value)
    const kept = byKey.get(key)
    if (kept === undefined || (!kept.startsWith('[[') && value.startsWith('[['))) byKey.set(key, value)
  }
  return [...byKey.values()].sort((a, b) => displayName(a).localeCompare(displayName(b)))
}

export function stringToColor(s: string): string {
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash)
  return `hsl(${Math.abs(hash) % 360}, 55%, 45%)`
}

export function isTerminalStatus(status: string, statuses: StatusConfig[]): boolean {
  const cfg = statuses.find((s) => s.id === status)
  return cfg ? cfg.complete : false
}

export function getDefaultStatusId(statuses: StatusConfig[]): string {
  return statuses.length > 0 ? statuses[0].id : 'todo'
}

export function getDefaultPriorityId(priorities: PriorityConfig[]): string {
  if (priorities.some((p) => p.id === 'medium')) return 'medium'
  return priorities.length > 0 ? priorities[Math.floor(priorities.length / 2)].id : 'medium'
}

export function getCompleteStatusId(statuses: StatusConfig[]): string {
  const found = statuses.find((s) => s.complete)
  return found ? found.id : 'done'
}

export function statusSortOrder(status: string, statuses: StatusConfig[]): number {
  const idx = statuses.findIndex((s) => s.id === status)
  return idx >= 0 ? idx : 999
}

/** A past date only reads as overdue when `overdue` says something is still open on it. */
export function dateUrgency(due: string, overdue: boolean): DueUrgency {
  const date = parsePlainDate(due)
  if (!date) return 'normal'
  const days = today().until(date, { largestUnit: 'day' }).days
  if (days < 0) return overdue ? 'overdue' : 'normal'
  return days < 3 ? 'near' : 'normal'
}

/** Terminal tasks are never urgent. */
export function dueUrgency(task: Task, statuses: StatusConfig[]): DueUrgency {
  if (isTerminalStatus(task.status, statuses)) return 'normal'
  return dateUrgency(task.due, true)
}

/** Objects fall back to '' rather than rendering as [object Object]. */
export function stringifyCustomValue(val: unknown): string {
  if (val === undefined || val === null) return ''
  if (typeof val === 'string') return val
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  if (Array.isArray(val)) return val.map((v) => String(v)).join(', ')
  return ''
}

export function truncateTitle(title: string, maxLen = 20): string {
  if (title.length <= maxLen) return title
  return title.slice(0, maxLen - 1) + '…'
}

export function sanitizeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '-')
}

export function getStatusConfig(statuses: StatusConfig[], id: string): StatusConfig | undefined {
  return statuses.find((s) => s.id === id)
}

export function getPriorityConfig(priorities: PriorityConfig[], id: TaskPriority): PriorityConfig | undefined {
  return priorities.find((p) => p.id === id)
}

/**
 * A priority's own icon wins; otherwise the icon set supplies one for its rank in the
 * list. A scale longer than the set leaves its lowest ranks without an icon.
 */
export function priorityIcon(priorities: PriorityConfig[], id: TaskPriority, iconSet: PriorityIconSet): string {
  const own = getPriorityConfig(priorities, id)?.icon
  if (own) return own
  const rank = priorities.findIndex((p) => p.id === id)
  return PRIORITY_ICON_SETS[iconSet][rank] ?? ''
}

const iconNameCache = new Map<string, boolean>()

/** True for a Lucide id like 'flame', false for emoji or plain text. */
export function isIconName(icon: string): boolean {
  let known = iconNameCache.get(icon)
  if (known === undefined) {
    const probe = createSpan()
    setIcon(probe, icon)
    known = probe.childElementCount > 0
    iconNameCache.set(icon, known)
  }
  return known
}

/** "🔴 Critical". Named icons drop out; they can't render as text, so callers use setIcon. */
export function formatBadgeText(icon: string | undefined, label: string): string {
  if (icon && isIconName(icon)) return label
  return [icon, label].filter(Boolean).join(' ')
}

export function safeAsync<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => void {
  return (...args: A) => {
    void (async () => {
      try {
        await fn(...args)
      } catch (err: unknown) {
        console.error('[PM]', err)
        new Notice('Something went wrong. Check the console for details.')
      }
    })()
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg'

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

/**
 * Makes an element that isn't a button open something: click and Enter or Space both reach
 * `open`, and neither reaches the row or card behind it.
 */
export function makeActivatable(el: HTMLElement, open: () => void): void {
  el.setAttr('role', 'link')
  el.setAttr('tabindex', '0')
  el.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    open()
  })
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    e.stopPropagation()
    open()
  })
}

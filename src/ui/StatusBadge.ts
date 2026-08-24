import { Menu } from 'obsidian'
import type { Task, TaskStatus, TaskPriority, StatusConfig, PriorityConfig, PriorityIconSet } from '../types'
import { getStatusConfig, getPriorityConfig, formatBadgeText, isIconName, priorityIcon } from '../utils'
import { Chip } from './primitives/Chip'

/** Named icons only. Emoji and text render inline through formatBadgeText instead. */
function namedIcon(config: { icon: string } | undefined): string | null {
  return config?.icon && isIconName(config.icon) ? config.icon : null
}

export interface PaletteMenuEntry {
  label: string
  icon: string
  /** The named icon to show when it isn't the entry's own: a priority's rank icon. */
  namedIcon?: string
}

/** One status or priority in a menu, so every menu that lists them places their icons alike. */
export function addPaletteMenuItem(
  menu: Menu,
  entry: PaletteMenuEntry,
  opts: { checked?: boolean; onClick: () => void }
): void {
  menu.addItem((item) => {
    item.setTitle(formatBadgeText(entry.icon, entry.label)).onClick(opts.onClick)
    if (opts.checked !== undefined) item.setChecked(opts.checked)
    const icon = entry.namedIcon ?? entry.icon
    if (isIconName(icon)) item.setIcon(icon)
  })
}

export function renderStatusBadge(
  container: HTMLElement,
  task: Task,
  statuses: StatusConfig[],
  onChange: (status: TaskStatus) => void
): HTMLElement {
  const config = getStatusConfig(statuses, task.status)
  const badge = new Chip(container)
    .setLabel(formatBadgeText(config?.icon, config?.label ?? task.status))
    .setColor(config?.color ?? 'var(--text-muted)')
    .setVariant('solid')
    .setDot(!config?.icon)
    .onClick((e) => {
      const menu = new Menu()
      for (const s of statuses) {
        addPaletteMenuItem(menu, s, { checked: s.id === task.status, onClick: () => onChange(s.id) })
      }
      menu.showAtMouseEvent(e)
    })
  const icon = namedIcon(config)
  if (icon) badge.setLeadingIcon(icon)
  return badge.el
}

export function renderPriorityBadge(
  container: HTMLElement,
  task: Task,
  priorities: PriorityConfig[],
  iconSet: PriorityIconSet,
  onChange: (priority: TaskPriority) => void
): HTMLElement {
  const config = getPriorityConfig(priorities, task.priority)
  const badge = new Chip(container)
    .setLabel(formatBadgeText(config?.icon, config?.label ?? task.priority))
    .setColor(config?.color ?? 'var(--text-muted)')
    .setVariant('plain')
  const icon = priorityIcon(priorities, task.priority, iconSet)
  if (isIconName(icon)) badge.setLeadingIcon(icon)
  badge.onClick((e) => {
    const menu = new Menu()
    for (const p of priorities) {
      addPaletteMenuItem(
        menu,
        { ...p, namedIcon: priorityIcon(priorities, p.id, iconSet) },
        { checked: p.id === task.priority, onClick: () => onChange(p.id) }
      )
    }
    menu.showAtMouseEvent(e)
  })
  return badge.el
}

export function renderStatusDot(
  container: HTMLElement,
  status: TaskStatus,
  statuses: StatusConfig[],
  cls = 'pm-subtask-dot'
): HTMLElement {
  const config = getStatusConfig(statuses, status)
  const dot = container.createSpan({ cls })
  dot.style.background = config?.color ?? 'var(--text-muted)'
  return dot
}

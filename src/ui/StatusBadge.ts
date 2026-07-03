import { Menu } from 'obsidian'
import type { Task, TaskStatus, TaskPriority, StatusConfig, PriorityConfig } from '../types'
import { getStatusConfig, getPriorityConfig, formatBadgeText, isIconName } from '../utils'
import { Chip } from './primitives/Chip'

/** Returns the config's icon when it's a named (Lucide) icon; emoji/text icons render inline via formatBadgeText. */
function namedIcon(config: { icon: string } | undefined): string | null {
  return config?.icon && isIconName(config.icon) ? config.icon : null
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
        menu.addItem((item) => {
          item
            .setTitle(formatBadgeText(s.icon, s.label))
            .setChecked(s.id === task.status)
            .onClick(() => onChange(s.id))
          const icon = namedIcon(s)
          if (icon) item.setIcon(icon)
        })
      }
      menu.showAtMouseEvent(e)
    })
  const icon = namedIcon(config)
  if (icon) badge.setLeadingIcon(icon)
  return badge.el
}

export const PRIORITY_CHEVRONS: Record<string, string> = {
  critical: 'chevrons-up',
  high: 'chevron-up',
  medium: 'equal',
  low: 'chevron-down'
}

export function renderPriorityBadge(
  container: HTMLElement,
  task: Task,
  priorities: PriorityConfig[],
  onChange: (priority: TaskPriority) => void
): HTMLElement {
  const config = getPriorityConfig(priorities, task.priority)
  const badge = new Chip(container)
    .setLabel(formatBadgeText(config?.icon, config?.label ?? task.priority))
    .setColor(config?.color ?? 'var(--text-muted)')
    .setVariant('plain')
  const icon = namedIcon(config)
  if (icon) {
    badge.setLeadingIcon(icon)
  } else if (!config?.icon) {
    badge.setLeadingIcon(PRIORITY_CHEVRONS[task.priority] ?? 'equal')
  }
  badge.onClick((e) => {
    const menu = new Menu()
    for (const p of priorities) {
      menu.addItem((item) => {
        item
          .setTitle(formatBadgeText(p.icon, p.label))
          .setChecked(p.id === task.priority)
          .onClick(() => onChange(p.id))
        const itemIcon = namedIcon(p)
        if (itemIcon) item.setIcon(itemIcon)
      })
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

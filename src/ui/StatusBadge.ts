import { Menu } from 'obsidian'
import type { Task, TaskStatus, TaskPriority, StatusConfig, PriorityConfig } from '../types'
import { getStatusConfig, getPriorityConfig, formatBadgeText } from '../utils'
import { Chip } from './primitives/Chip'

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
        menu.addItem((item) =>
          item
            .setTitle(formatBadgeText(s.icon, s.label))
            .setChecked(s.id === task.status)
            .onClick(() => onChange(s.id))
        )
      }
      menu.showAtMouseEvent(e)
    })
  return badge.el
}

export const PRIORITY_CHEVRONS: Record<TaskPriority, string> = {
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
  if (!config?.icon) {
    badge.setLeadingIcon(PRIORITY_CHEVRONS[task.priority])
  }
  badge.onClick((e) => {
    const menu = new Menu()
    for (const p of priorities) {
      menu.addItem((item) =>
        item
          .setTitle(formatBadgeText(p.icon, p.label))
          .setChecked(p.id === task.priority)
          .onClick(() => onChange(p.id))
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

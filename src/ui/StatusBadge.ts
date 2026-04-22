import { Menu } from 'obsidian'
import type { Task, TaskStatus, TaskPriority, StatusConfig, PriorityConfig } from '../types'
import { COLOR_MUTED, COLOR_MUTED_ALT } from '../constants'
import { getStatusConfig, getPriorityConfig, formatBadgeText } from '../utils'

/**
 * Render a clickable status badge that opens a menu to change the status.
 */
export function renderStatusBadge(
  container: HTMLElement,
  task: Task,
  statuses: StatusConfig[],
  onChange: (status: TaskStatus) => void
): HTMLElement {
  const config = getStatusConfig(statuses, task.status)
  const badge = container.createEl('span', {
    text: formatBadgeText(config?.icon, config?.label ?? task.status),
    cls: 'pm-status-badge'
  })
  badge.style.setProperty('--badge-color', config?.color ?? COLOR_MUTED)
  badge.addEventListener('click', (e) => {
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
  return badge
}

/**
 * Render a clickable priority badge that opens a menu to change the priority.
 */
export function renderPriorityBadge(
  container: HTMLElement,
  task: Task,
  priorities: PriorityConfig[],
  onChange: (priority: TaskPriority) => void
): HTMLElement {
  const config = getPriorityConfig(priorities, task.priority)
  const badge = container.createEl('span', {
    text: formatBadgeText(config?.icon, config?.label ?? task.priority),
    cls: 'pm-priority-badge'
  })
  badge.style.setProperty('--badge-color', config?.color ?? COLOR_MUTED_ALT)
  badge.addEventListener('click', (e) => {
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
  return badge
}

/**
 * Render a simple status dot (colored circle).
 */
export function renderStatusDot(
  container: HTMLElement,
  status: TaskStatus,
  statuses: StatusConfig[],
  cls = 'pm-subtask-dot'
): HTMLElement {
  const config = getStatusConfig(statuses, status)
  const dot = container.createEl('span', { cls })
  dot.style.background = config?.color ?? COLOR_MUTED
  return dot
}

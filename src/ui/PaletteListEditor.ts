import { Notice } from 'obsidian'
import type { PriorityConfig, StatusConfig } from '../types'
import { IconButton } from './primitives/IconButton'
import { renderIconControl } from './composites/properties'

/** On drop, moves the dragged item to this row's index. */
export function wireRowDragReorder<T>(row: HTMLElement, index: number, items: T[], onChanged: () => void): void {
  row.createSpan({ text: '⠿', cls: 'pm-settings-drag-handle' })
  row.draggable = true
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData('text/plain', String(index))
    row.addClass('pm-settings-row--dragging')
  })
  row.addEventListener('dragend', () => {
    row.removeClass('pm-settings-row--dragging')
  })
  row.addEventListener('dragover', (e) => {
    e.preventDefault()
  })
  row.addEventListener('drop', (e) => {
    e.preventDefault()
    const fromIdx = parseInt(e.dataTransfer?.getData('text/plain') ?? '', 10)
    if (isNaN(fromIdx) || fromIdx === index) return
    const [moved] = items.splice(fromIdx, 1)
    items.splice(index, 0, moved)
    onChanged()
  })
}

export interface PaletteEntry {
  id: string
  label: string
  color: string
  icon: string
}

/** Appends the icon, label, and color inputs to `parent`, in that order. */
export function renderPaletteFields(parent: HTMLElement, item: PaletteEntry, onChanged: () => void): void {
  const iconCell = parent.createDiv('pm-settings-status-icon')
  renderIconControl({
    container: iconCell,
    value: item.icon,
    color: item.color,
    onChange: (icon) => {
      item.icon = icon
      onChanged()
    }
  })

  const label = parent.createEl('input', { type: 'text', value: item.label })
  label.addClass('pm-settings-status-label')
  label.addEventListener('change', () => {
    item.label = label.value
    onChanged()
  })

  const color = parent.createEl('input', { type: 'color', value: item.color })
  color.addEventListener('change', () => {
    item.color = color.value
    onChanged()
  })
}

/** Marks which statuses count as complete. */
export function renderStatusDoneToggle(parent: HTMLElement, status: StatusConfig, onChanged: () => void): void {
  const wrapper = parent.createEl('label', { cls: 'pm-settings-complete-toggle' })
  const checkbox = wrapper.createEl('input', { type: 'checkbox' })
  checkbox.checked = status.complete
  wrapper.createSpan({ text: 'Done', cls: 'pm-settings-complete-text' })
  checkbox.addEventListener('change', () => {
    status.complete = checkbox.checked
    onChanged()
  })
}

interface PaletteListEditorOpts<T extends PaletteEntry> {
  items: T[]
  /** Called after every mutation, so the owner can persist. */
  onChanged: () => void
  /** Called after an entry is removed, e.g. to remap orphaned tasks. */
  onDeleted?: (deleted: T) => void
  /** Notice shown when deleting would leave the list empty. */
  minOneMessage: string
  /** Extra per-row controls between the color picker and the delete button. */
  renderExtra?: (row: HTMLElement, item: T) => void
}

/** Drag handle, icon picker, label, color, delete. */
function renderPaletteListEditor<T extends PaletteEntry>(container: HTMLElement, opts: PaletteListEditorOpts<T>): void {
  const rerender = (): void => renderPaletteListEditor(container, opts)
  container.empty()
  opts.items.forEach((item, i) => {
    const row = container.createDiv('pm-settings-status-row')

    wireRowDragReorder(row, i, opts.items, () => {
      opts.onChanged()
      rerender()
    })

    renderPaletteFields(row, item, opts.onChanged)

    opts.renderExtra?.(row, item)

    new IconButton(row)
      .setIcon('x')
      .setTooltip('Remove')
      .onClick(() => {
        if (opts.items.length <= 1) {
          new Notice(opts.minOneMessage)
          return
        }
        opts.items.splice(i, 1)
        opts.onChanged()
        rerender()
        opts.onDeleted?.(item)
      })
  })
}

export interface StatusListEditorOpts {
  statuses: StatusConfig[]
  onChanged: () => void
  onDeleted?: (deleted: StatusConfig) => void
}

/** Palette rows plus the per-status Done toggle. */
export function renderStatusListEditor(container: HTMLElement, opts: StatusListEditorOpts): void {
  renderPaletteListEditor<StatusConfig>(container, {
    items: opts.statuses,
    onChanged: opts.onChanged,
    onDeleted: opts.onDeleted,
    minOneMessage: 'You must have at least one status.',
    renderExtra: (row, status) => renderStatusDoneToggle(row, status, opts.onChanged)
  })
}

export interface PriorityListEditorOpts {
  priorities: PriorityConfig[]
  onChanged: () => void
  onDeleted?: (deleted: PriorityConfig) => void
}

export function renderPriorityListEditor(container: HTMLElement, opts: PriorityListEditorOpts): void {
  renderPaletteListEditor<PriorityConfig>(container, {
    items: opts.priorities,
    onChanged: opts.onChanged,
    onDeleted: opts.onDeleted,
    minOneMessage: 'You must have at least one priority.'
  })
}

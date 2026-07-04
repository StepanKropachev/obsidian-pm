import { AbstractInputSuggest, App, Notice, getIconIds, setIcon } from 'obsidian'
import type { PriorityConfig, StatusConfig } from '../types'
import { IconButton } from './primitives/IconButton'

/** Suggests Lucide icon ids for the status/priority icon inputs. Typed emoji are kept as-is. */
class IconSuggest extends AbstractInputSuggest<string> {
  protected getSuggestions(query: string): string[] {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return getIconIds()
      .filter((id) => id.includes(q))
      .slice(0, 24)
  }

  renderSuggestion(id: string, el: HTMLElement): void {
    el.addClass('pm-icon-suggestion')
    setIcon(el.createSpan({ cls: 'pm-icon-suggestion-glyph' }), id)
    el.createSpan({ text: id })
  }
}

/** Wire icon-name suggestions to an icon input; picking a suggestion saves through the input's change handler. */
export function attachIconSuggest(app: App, input: HTMLInputElement): void {
  const suggest = new IconSuggest(app, input)
  suggest.onSelect((id) => {
    suggest.setValue(id)
    input.dispatchEvent(new Event('change'))
    suggest.close()
  })
}

/** Wire drag-to-reorder on a config row; on drop, moves the dragged item to this row's index. */
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

interface PaletteEntry {
  id: string
  label: string
  color: string
  icon: string
}

interface PaletteListEditorOpts<T extends PaletteEntry> {
  app: App
  /** The list to edit; mutated in place. */
  items: T[]
  /** Called after every mutation (edit, reorder, delete) so the owner can persist. */
  onChanged: () => void
  /** Called after an entry is removed, e.g. to remap orphaned tasks. */
  onDeleted?: (deleted: T) => void
  /** Notice shown when deleting would leave the list empty. */
  minOneMessage: string
  /** Extra per-row controls between the color picker and the delete button. */
  renderExtra?: (row: HTMLElement, item: T) => void
}

/**
 * The palette row editor (drag handle, icon with suggestions, label, color,
 * delete) shared by the status and priority lists in both the plugin settings
 * and the per-project overrides in the project modal.
 */
function renderPaletteListEditor<T extends PaletteEntry>(container: HTMLElement, opts: PaletteListEditorOpts<T>): void {
  const rerender = (): void => renderPaletteListEditor(container, opts)
  container.empty()
  opts.items.forEach((item, i) => {
    const row = container.createDiv('pm-settings-status-row')

    wireRowDragReorder(row, i, opts.items, () => {
      opts.onChanged()
      rerender()
    })

    // Icon input: emoji or a Lucide icon id (with suggestions)
    const icon = row.createEl('input', { type: 'text', value: item.icon })
    icon.addClass('pm-settings-status-icon')
    icon.placeholder = ''
    attachIconSuggest(opts.app, icon)
    icon.addEventListener('change', () => {
      item.icon = icon.value
      opts.onChanged()
    })

    // Label input
    const label = row.createEl('input', { type: 'text', value: item.label })
    label.addClass('pm-settings-status-label')
    label.addEventListener('change', () => {
      item.label = label.value
      opts.onChanged()
    })

    // Color picker
    const color = row.createEl('input', { type: 'color', value: item.color })
    color.addEventListener('change', () => {
      item.color = color.value
      opts.onChanged()
    })

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
  app: App
  statuses: StatusConfig[]
  onChanged: () => void
  onDeleted?: (deleted: StatusConfig) => void
}

/** Status list editor: palette rows plus the per-status Done toggle. */
export function renderStatusListEditor(container: HTMLElement, opts: StatusListEditorOpts): void {
  renderPaletteListEditor<StatusConfig>(container, {
    app: opts.app,
    items: opts.statuses,
    onChanged: opts.onChanged,
    onDeleted: opts.onDeleted,
    minOneMessage: 'You must have at least one status.',
    renderExtra: (row, status) => {
      const completeLabel = row.createEl('label', { cls: 'pm-settings-complete-toggle' })
      const checkbox = completeLabel.createEl('input', { type: 'checkbox' })
      checkbox.checked = status.complete
      completeLabel.createSpan({ text: 'Done', cls: 'pm-settings-complete-text' })
      checkbox.addEventListener('change', () => {
        status.complete = checkbox.checked
        opts.onChanged()
      })
    }
  })
}

export interface PriorityListEditorOpts {
  app: App
  priorities: PriorityConfig[]
  onChanged: () => void
  onDeleted?: (deleted: PriorityConfig) => void
}

export function renderPriorityListEditor(container: HTMLElement, opts: PriorityListEditorOpts): void {
  renderPaletteListEditor<PriorityConfig>(container, {
    app: opts.app,
    items: opts.priorities,
    onChanged: opts.onChanged,
    onDeleted: opts.onDeleted,
    minOneMessage: 'You must have at least one priority.'
  })
}

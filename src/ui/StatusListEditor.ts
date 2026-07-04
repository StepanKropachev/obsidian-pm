import { AbstractInputSuggest, App, Notice, getIconIds, setIcon } from 'obsidian'
import type { StatusConfig } from '../types'

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

export interface StatusListEditorOpts {
  app: App
  /** The list to edit; mutated in place. */
  statuses: StatusConfig[]
  /** Called after every mutation (edit, reorder, delete) so the owner can persist. */
  onChanged: () => void
  /** Called after a status is removed, e.g. to remap orphaned tasks. */
  onDeleted?: (deleted: StatusConfig) => void
}

/**
 * The status row editor (drag handle, icon with suggestions, label, color,
 * complete toggle, delete) used by both the plugin settings and the per-project
 * status override in the project modal.
 */
export function renderStatusListEditor(container: HTMLElement, opts: StatusListEditorOpts): void {
  const rerender = (): void => renderStatusListEditor(container, opts)
  container.empty()
  opts.statuses.forEach((s, i) => {
    const row = container.createDiv('pm-settings-status-row')

    wireRowDragReorder(row, i, opts.statuses, () => {
      opts.onChanged()
      rerender()
    })

    // Icon input: emoji or a Lucide icon id (with suggestions)
    const icon = row.createEl('input', { type: 'text', value: s.icon })
    icon.addClass('pm-settings-status-icon')
    icon.placeholder = ''
    attachIconSuggest(opts.app, icon)
    icon.addEventListener('change', () => {
      s.icon = icon.value
      opts.onChanged()
    })

    // Label input
    const label = row.createEl('input', { type: 'text', value: s.label })
    label.addClass('pm-settings-status-label')
    label.addEventListener('change', () => {
      s.label = label.value
      opts.onChanged()
    })

    // Color picker
    const color = row.createEl('input', { type: 'color', value: s.color })
    color.addEventListener('change', () => {
      s.color = color.value
      opts.onChanged()
    })

    // Complete toggle
    const completeLabel = row.createEl('label', { cls: 'pm-settings-complete-toggle' })
    const checkbox = completeLabel.createEl('input', { type: 'checkbox' })
    checkbox.checked = s.complete
    completeLabel.createSpan({ text: 'Done', cls: 'pm-settings-complete-text' })
    checkbox.addEventListener('change', () => {
      s.complete = checkbox.checked
      opts.onChanged()
    })

    // Delete button
    const del = row.createEl('button', { text: '✕', cls: 'pm-settings-del' })
    del.addEventListener('click', () => {
      if (opts.statuses.length <= 1) {
        new Notice('You must have at least one status.')
        return
      }
      opts.statuses.splice(i, 1)
      opts.onChanged()
      rerender()
      opts.onDeleted?.(s)
    })
  })
}

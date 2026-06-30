import { setIcon } from 'obsidian'
import { Popover } from '../../primitives/Popover'
import { renderGlyph, renderOptionRow, SelectItem } from './optionList'

export interface SelectControlOpts {
  container: HTMLElement
  value: string | null
  options: SelectItem[]
  onChange: (id: string) => void
  placeholder?: string
  search?: boolean
  searchPlaceholder?: string
  width?: number
}

/**
 * Single-select inline control: a quiet trigger showing the current value that opens a
 * popover option list, optionally filtered by a search box. Backs Status, Priority, Type,
 * Repeat, and Parent task.
 */
export function renderSelectControl(opts: SelectControlOpts): void {
  const selected = opts.options.find((o) => o.id === opts.value) ?? null
  const trigger = opts.container.createEl('button', { cls: 'pm-prop-inline' })
  if (!selected) trigger.addClass('pm-prop-inline--empty')
  renderGlyph(trigger, { color: selected?.color, icon: selected?.icon })
  trigger.createSpan({ cls: 'pm-prop-inline-label', text: selected?.label ?? opts.placeholder ?? 'Select' })
  const chevron = trigger.createSpan({ cls: 'pm-prop-chevron' })
  setIcon(chevron, 'chevron-down')

  let pop: Popover | null = null
  trigger.addEventListener('click', () => {
    if (pop?.isOpen) {
      pop.close()
      return
    }
    pop = new Popover({ anchor: trigger, width: opts.width ?? trigger.offsetWidth, onClose: () => (pop = null) })
    const searchInput = opts.search
      ? pop.contentEl.createEl('input', {
          cls: 'pm-pop-field',
          attr: { placeholder: opts.searchPlaceholder ?? 'Search…', spellcheck: 'false' }
        })
      : null
    const list = pop.contentEl.createDiv('pm-pop-list')
    const renderList = () => {
      list.empty()
      const q = searchInput?.value.trim().toLowerCase() ?? ''
      for (const o of opts.options.filter((it) => !q || it.label.toLowerCase().includes(q))) {
        renderOptionRow(list, {
          label: o.label,
          color: o.color,
          icon: o.icon,
          selected: o.id === opts.value,
          onPick: () => {
            pop?.close()
            opts.onChange(o.id)
          }
        })
      }
    }
    searchInput?.addEventListener('input', () => renderList())
    renderList()
    pop.open()
    searchInput?.focus()
  })
}

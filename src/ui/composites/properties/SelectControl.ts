import { setIcon } from 'obsidian'
import { Popover } from '../../primitives/Popover'
import { renderGlyph, renderOptionRow, SelectItem } from './optionList'

export interface SelectControlOpts {
  container: HTMLElement
  value: string | null
  options: SelectItem[]
  onChange: (id: string) => void
  menuLabel?: string
  placeholder?: string
  width?: number
}

/**
 * Single-select inline control: a quiet trigger showing the current value that opens a
 * popover option list. Backs Status, Priority, Type, and Repeat.
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
    pop = new Popover({ anchor: trigger, width: opts.width ?? 200, onClose: () => (pop = null) })
    if (opts.menuLabel) pop.contentEl.createDiv({ cls: 'pm-pop-label', text: opts.menuLabel })
    const list = pop.contentEl.createDiv('pm-pop-list')
    for (const o of opts.options) {
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
    pop.open()
  })
}

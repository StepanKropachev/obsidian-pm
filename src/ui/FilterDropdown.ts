import { Menu } from 'obsidian'
import { Pill } from './primitives/Pill'

export function renderFilterDropdown(
  parent: HTMLElement,
  label: string,
  selected: string[],
  options: { id: string; label: string }[],
  onChange: (selected: string[]) => void
): HTMLElement {
  const pill = new Pill(parent).setAriaLabel(`Filter by ${label}`)

  const updatePill = () => {
    const has = selected.length > 0
    pill.setLabel(has ? `${label}: ${selected.length}` : label).setActive(has)
  }
  updatePill()

  pill.onClick((e) => {
    const menu = new Menu()
    for (const opt of options) {
      menu.addItem((item) =>
        item
          .setTitle(opt.label)
          .setChecked(selected.includes(opt.id))
          .onClick(() => {
            const idx = selected.indexOf(opt.id)
            if (idx >= 0) selected.splice(idx, 1)
            else selected.push(opt.id)
            onChange(selected)
            updatePill()
          })
      )
    }
    if (selected.length) {
      menu.addSeparator()
      menu.addItem((item) =>
        item.setTitle('Clear').onClick(() => {
          selected.length = 0
          onChange(selected)
          updatePill()
        })
      )
    }
    menu.showAtMouseEvent(e)
  })

  pill.el.setAttribute('role', 'combobox')
  return pill.el
}

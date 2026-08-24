import { Menu } from 'obsidian'
import { ChipButton } from './primitives/ChipButton'
import { addPaletteMenuItem } from './StatusBadge'

export interface FilterOption {
  id: string
  label: string
  /** A status or priority icon: emoji render in the label, named icons beside it. */
  icon?: string
  namedIcon?: string
}

export function renderFilterDropdown(
  parent: HTMLElement,
  label: string,
  selected: string[],
  options: FilterOption[],
  onChange: (selected: string[]) => void
): HTMLElement {
  const btn = new ChipButton(parent).setAriaLabel(`Filter by ${label}`)

  const updateLabel = () => {
    const has = selected.length > 0
    btn.setLabel(has ? `${label}: ${selected.length}` : label).setActive(has)
  }
  updateLabel()

  btn.onClick((e) => {
    const menu = new Menu()
    for (const opt of options) {
      addPaletteMenuItem(
        menu,
        { label: opt.label, icon: opt.icon ?? '', namedIcon: opt.namedIcon },
        {
          checked: selected.includes(opt.id),
          onClick: () => {
            const idx = selected.indexOf(opt.id)
            if (idx >= 0) selected.splice(idx, 1)
            else selected.push(opt.id)
            onChange(selected)
            updateLabel()
          }
        }
      )
    }
    if (selected.length) {
      menu.addSeparator()
      menu.addItem((item) =>
        item.setTitle('Clear').onClick(() => {
          selected.length = 0
          onChange(selected)
          updateLabel()
        })
      )
    }
    menu.showAtMouseEvent(e)
  })

  btn.el.setAttribute('role', 'combobox')
  return btn.el
}

import { Menu } from 'obsidian'

/**
 * Render a filter dropdown button that opens a multi-select menu.
 * Used in TableView's filter bar for status, priority, assignee, tag filters.
 */
export function renderFilterDropdown(
  parent: HTMLElement,
  label: string,
  selected: string[],
  options: { id: string; label: string }[],
  onChange: (selected: string[]) => void
): HTMLElement {
  const hasSelection = selected.length > 0
  const btn = parent.createEl('button', {
    text: hasSelection ? `${label}: ${selected.length}` : label,
    cls: 'pm-filter-dropdown-btn',
    attr: { 'aria-label': `Filter by ${label}`, role: 'combobox' }
  })
  if (hasSelection) btn.addClass('pm-filter-dropdown-btn--active')

  btn.addEventListener('click', (e) => {
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
          })
      )
    }
    if (selected.length) {
      menu.addSeparator()
      menu.addItem((item) =>
        item.setTitle('Clear').onClick(() => {
          selected.length = 0
          onChange(selected)
        })
      )
    }
    menu.showAtMouseEvent(e)
  })

  return btn
}

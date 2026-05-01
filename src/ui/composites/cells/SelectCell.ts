export interface SelectCellProps {
  checked: boolean
  onClick: (e: MouseEvent) => void
}

export class SelectCell {
  el: HTMLTableCellElement

  constructor(parentRow: HTMLElement, props: SelectCellProps) {
    this.el = parentRow.createEl('td', { cls: 'pm-table-cell-select' })
    const cb = this.el.createEl('input', { type: 'checkbox', cls: 'pm-select-checkbox' })
    cb.checked = props.checked
    cb.addEventListener('click', (e) => {
      e.stopPropagation()
      props.onClick(e)
    })
  }
}

import { IconButton } from '../../primitives/IconButton'

export interface ActionsCellProps {
  onClick: (e: MouseEvent) => void
}

export class ActionsCell {
  el: HTMLTableCellElement

  constructor(parentRow: HTMLElement, props: ActionsCellProps) {
    this.el = parentRow.createEl('td', { cls: 'pm-table-cell pm-table-cell-actions' })
    new IconButton(this.el)
      .setIcon('more-horizontal')
      .setTooltip('Task actions')
      .setRevealOnHover(true)
      .onClick(props.onClick)
  }
}

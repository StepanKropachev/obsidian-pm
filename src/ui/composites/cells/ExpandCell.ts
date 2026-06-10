import { CollapseToggle } from '../../primitives/CollapseToggle'

export interface ExpandCellProps {
  hasSubtasks: boolean
  collapsed: boolean
  onToggle: () => void
}

export class ExpandCell {
  el: HTMLTableCellElement

  constructor(parentRow: HTMLElement, props: ExpandCellProps) {
    this.el = parentRow.createEl('td', { cls: 'pm-table-cell-expand' })
    if (props.hasSubtasks) {
      new CollapseToggle(this.el, { collapsed: props.collapsed, onToggle: props.onToggle })
    }
  }
}

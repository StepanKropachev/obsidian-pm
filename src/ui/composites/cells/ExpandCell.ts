import { IconButton } from '../../primitives/IconButton'

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
      new IconButton(this.el)
        .setIcon(props.collapsed ? 'chevron-right' : 'chevron-down')
        .setTooltip(props.collapsed ? 'Expand subtasks' : 'Collapse subtasks')
        .onClick(props.onToggle)
    }
  }
}

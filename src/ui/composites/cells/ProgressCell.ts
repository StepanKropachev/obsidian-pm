import { ProgressBar } from '../../primitives/ProgressBar'

export interface ProgressCellProps {
  value: number
  color: string
}

export class ProgressCell {
  el: HTMLTableCellElement

  constructor(parentRow: HTMLElement, props: ProgressCellProps) {
    this.el = parentRow.createEl('td', { cls: 'pm-table-cell pm-table-cell-progress' })
    new ProgressBar(this.el).setValue(props.value).setColor(props.color).setShowLabel(true)
  }
}

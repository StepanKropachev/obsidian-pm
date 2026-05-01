import { TimeChip } from '../../primitives/TimeChip'

export interface TimeCellProps {
  logged: number
  estimate: number
}

export class TimeCell {
  el: HTMLTableCellElement

  constructor(parentRow: HTMLElement, props: TimeCellProps) {
    this.el = parentRow.createEl('td', { cls: 'pm-table-cell pm-table-cell-time' })
    if (props.logged > 0 || props.estimate > 0) {
      new TimeChip(this.el).setHours(props.logged, props.estimate)
    }
  }
}

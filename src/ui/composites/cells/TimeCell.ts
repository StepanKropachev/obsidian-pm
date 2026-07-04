import { renderTimeChip } from '../timeChip'

export interface TimeCellProps {
  logged: number
  estimate: number
}

export class TimeCell {
  el: HTMLTableCellElement

  constructor(parentRow: HTMLElement, props: TimeCellProps) {
    this.el = parentRow.createEl('td', { cls: 'pm-table-cell pm-table-cell-time' })
    renderTimeChip(this.el, props.logged, props.estimate)
  }
}

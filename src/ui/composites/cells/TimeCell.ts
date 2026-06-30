import { Chip } from '../../primitives/Chip'

export interface TimeCellProps {
  logged: number
  estimate: number
}

export class TimeCell {
  el: HTMLTableCellElement

  constructor(parentRow: HTMLElement, props: TimeCellProps) {
    this.el = parentRow.createEl('td', { cls: 'pm-table-cell pm-table-cell-time' })
    const { logged, estimate } = props
    if (logged <= 0 && estimate <= 0) return

    const label = estimate > 0 ? `${logged}/${estimate}h` : `${logged}h`
    const chip = new Chip(this.el).setLabel(label)
    if (estimate > 0 && logged > estimate) {
      chip.setVariant('solid').setColor('var(--color-red)').setStrong()
    }
  }
}

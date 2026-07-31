import { ProgressBar } from '../../primitives/ProgressBar'
import { makeInlineEdit } from './inlineEdit'

export interface ProgressCellProps {
  value: number
  color: string
  onSave: (value: number) => Promise<void>
}

export class ProgressCell {
  el: HTMLTableCellElement

  constructor(parentRow: HTMLElement, props: ProgressCellProps) {
    this.el = parentRow.createEl('td', { cls: 'pm-table-cell pm-table-cell-progress' })
    const bar = new ProgressBar(this.el).setValue(props.value).setColor(props.color).setShowLabel(true)
    bar.el.addEventListener('click', (e) => {
      e.stopPropagation()
      makeInlineEdit({
        container: this.el,
        display: bar.el,
        inputType: 'number',
        value: String(props.value),
        onSave: (v) => props.onSave(Math.max(0, Math.min(100, Math.round(parseFloat(v) || 0))))
      })
    })
  }
}

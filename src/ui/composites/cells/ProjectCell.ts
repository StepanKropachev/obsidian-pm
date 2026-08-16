import { Chip } from '../../primitives/Chip'

/** Which project a row's task belongs to. Only rendered when the table spans several. */
export class ProjectCell {
  el: HTMLTableCellElement

  constructor(parentRow: HTMLElement, props: { title: string; color: string }) {
    this.el = parentRow.createEl('td', { cls: 'pm-table-cell' })
    new Chip(this.el).setLabel(props.title).setVariant('outline').setSize('sm').setDot(true).setColor(props.color)
  }
}

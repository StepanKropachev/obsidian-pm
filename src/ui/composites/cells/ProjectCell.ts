import { renderProjectChip, type ProjectChipProps } from '../projectChip'

/** Which project a row's task belongs to. Only rendered when the table spans several. */
export class ProjectCell {
  el: HTMLTableCellElement

  constructor(parentRow: HTMLElement, props: ProjectChipProps) {
    this.el = parentRow.createEl('td', { cls: 'pm-table-cell' })
    renderProjectChip(this.el, props)
  }
}

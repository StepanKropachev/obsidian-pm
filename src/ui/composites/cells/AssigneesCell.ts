import { AvatarStack } from '../../primitives/AvatarStack'

export class AssigneesCell {
  el: HTMLTableCellElement

  constructor(parentRow: HTMLElement, assignees: string[]) {
    this.el = parentRow.createEl('td', { cls: 'pm-table-cell pm-table-cell-assignees' })
    new AvatarStack(this.el).setNames(assignees).setMax(3)
  }
}

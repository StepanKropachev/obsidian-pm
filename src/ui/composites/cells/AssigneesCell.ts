import { AvatarStack, type AvatarPerson } from '../../primitives/AvatarStack'

export class AssigneesCell {
  el: HTMLTableCellElement

  constructor(parentRow: HTMLElement, people: AvatarPerson[]) {
    this.el = parentRow.createEl('td', { cls: 'pm-table-cell pm-table-cell-assignees' })
    new AvatarStack(this.el).setPeople(people).setMax(3)
  }
}

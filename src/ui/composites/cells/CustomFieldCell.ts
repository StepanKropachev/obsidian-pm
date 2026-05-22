export class CustomFieldCell {
  el: HTMLTableCellElement

  constructor(parentRow: HTMLElement, display: string) {
    this.el = parentRow.createEl('td', { cls: 'pm-table-cell' })
    this.el.createSpan({ text: display || '—', cls: 'pm-cf-value' })
  }
}

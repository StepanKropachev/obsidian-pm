const ROW_IGNORE_SELECTOR =
  'button, input, .pm-badge--interactive, .pm-task-title-text, .pm-due-chip, .pm-table-cell-select, .pm-icon-btn'

export interface TaskRowProps {
  taskId: string
  depth: number
  isDone: boolean
  isArchived: boolean
  isSelected: boolean
  onRowClick: () => void
}

export class TaskRow {
  el: HTMLTableRowElement

  constructor(tbody: HTMLElement, props: TaskRowProps) {
    this.el = tbody.createEl('tr', { cls: 'pm-table-row' })
    this.el.dataset.taskId = props.taskId
    if (props.isDone) this.el.addClass('pm-table-row--done')
    if (props.isArchived) this.el.addClass('pm-table-row--archived')
    if (props.isSelected) this.el.addClass('pm-table-row--selected')
    this.el.style.setProperty('--depth', String(props.depth))

    this.el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      if (target.closest(ROW_IGNORE_SELECTOR)) return
      props.onRowClick()
    })
  }
}

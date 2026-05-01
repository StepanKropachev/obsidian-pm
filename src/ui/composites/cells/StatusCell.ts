import type { Task, StatusConfig, TaskStatus } from '../../../types'
import { getStatusConfig } from '../../../utils'
import { renderStatusBadge } from '../../StatusBadge'

export interface StatusCellProps {
  task: Task
  statuses: StatusConfig[]
  onChange: (status: TaskStatus) => void
}

export class StatusCell {
  el: HTMLTableCellElement

  constructor(parentRow: HTMLElement, props: StatusCellProps) {
    this.el = parentRow.createEl('td', { cls: 'pm-table-cell' })
    if (getStatusConfig(props.statuses, props.task.status)) {
      renderStatusBadge(this.el, props.task, props.statuses, props.onChange)
    }
  }
}

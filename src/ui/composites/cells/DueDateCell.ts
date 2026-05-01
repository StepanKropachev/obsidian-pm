import type { Task } from '../../../types'
import { formatDateLong } from '../../../utils'
import { DueDateChip } from '../../primitives/DueDateChip'
import { makeInlineEdit } from './inlineEdit'

export interface DueDateCellProps {
  task: Task
  urgency: 'normal' | 'near' | 'overdue'
  onSave: (newDate: string) => Promise<void>
}

export class DueDateCell {
  el: HTMLTableCellElement

  constructor(parentRow: HTMLElement, props: DueDateCellProps) {
    const { task } = props
    this.el = parentRow.createEl('td', { cls: 'pm-table-cell' })

    const startEdit = (display: HTMLElement): void => {
      makeInlineEdit({
        container: this.el,
        display,
        inputType: 'date',
        value: task.due,
        onSave: props.onSave
      })
    }

    if (!task.due) {
      const chip = new DueDateChip(this.el)
        .setLabel('—')
        .setPlaceholder(true)
        .onClick((e) => {
          e.stopPropagation()
          startEdit(chip.el)
        })
      return
    }

    const chip = new DueDateChip(this.el)
      .setLabel(formatDateLong(task.due))
      .setUrgency(props.urgency)
      .onClick((e) => {
        e.stopPropagation()
        startEdit(chip.el)
      })
  }
}

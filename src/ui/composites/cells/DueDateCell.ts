import type { Task } from '../../../types'
import { formatDateLong } from '../../../utils'
import { Chip } from '../../primitives/Chip'
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
      const chip = new Chip(this.el)
        .setLabel('—')
        .setColor('var(--text-faint)')
        .onClick((e) => {
          e.stopPropagation()
          startEdit(chip.el)
        })
      return
    }

    const chip = new Chip(this.el).setLabel(formatDateLong(task.due))
    if (props.urgency === 'near') {
      chip.setVariant('solid').setColor('var(--color-orange)')
    } else if (props.urgency === 'overdue') {
      chip.setVariant('solid').setColor('var(--color-red)').setStrong()
    }
    chip.onClick((e) => {
      e.stopPropagation()
      startEdit(chip.el)
    })
  }
}

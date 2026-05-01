import type { Task } from '../../../types'
import { Badge } from '../../primitives/Badge'
import { Chip } from '../../primitives/Chip'
import { IconButton } from '../../primitives/IconButton'
import { makeInlineEdit } from './inlineEdit'

export interface TitleCellProps {
  task: Task
  depth: number
  onTitleClick: () => void
  onTitleSave: (newTitle: string) => Promise<void>
  onAddSubtask: () => void
}

export class TitleCell {
  el: HTMLTableCellElement

  constructor(parentRow: HTMLElement, props: TitleCellProps) {
    const { task } = props
    this.el = parentRow.createEl('td', { cls: 'pm-table-cell-title' })
    this.el.setCssStyles({ paddingLeft: `${props.depth * 20 + 8}px` })

    const titleSpan = this.el.createEl('span', { text: task.title, cls: 'pm-task-title-text' })
    titleSpan.addEventListener('click', () => props.onTitleClick())
    titleSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation()
      makeInlineEdit({
        container: this.el,
        display: titleSpan,
        inputType: 'text',
        value: task.title,
        onSave: props.onTitleSave
      })
    })

    new IconButton(this.el)
      .setIcon('plus')
      .setTooltip('Add subtask')
      .setRevealOnHover(true)
      .onClick((e) => {
        e.stopPropagation()
        props.onAddSubtask()
      })

    if (task.type === 'milestone') {
      new Badge(this.el).setLabel('M').setSize('sm').setColor('var(--color-purple)').setTooltip('Milestone')
    }
    if (task.type === 'subtask') {
      new Badge(this.el).setLabel('Sub').setSize('sm').setColor('var(--color-green)').setTooltip('Subtask')
    }
    if (task.recurrence) {
      new Badge(this.el).setLabel('R').setSize('sm').setColor('var(--color-blue)').setTooltip('Recurring')
    }
    if (task.archived) {
      new Badge(this.el).setLabel('Archived').setSize('sm').setColor('var(--text-muted)').setTooltip('Archived')
    }

    if (task.tags.length) {
      const tagRow = this.el.createDiv('pm-table-tags')
      for (const tag of task.tags) {
        new Chip(tagRow).setLabel(tag).setShape('pill')
      }
    }
  }
}

import type { Task } from '../../../types'
import { Chip } from '../../primitives/Chip'
import { IconButton } from '../../primitives/IconButton'
import { renderTagChip } from '../tagChip'
import { renderTreeGuides } from '../treeGuides'
import { makeInlineEdit } from './inlineEdit'

export interface TitleCellProps {
  task: Task
  /** One entry per indent column: does an ancestor at that column still have rows below it. Null draws no connectors. */
  treeGuides: boolean[] | null
  isLastChild: boolean
  showTagColors: boolean
  onTitleClick: () => void
  onTitleSave: (newTitle: string) => Promise<void>
  onAddSubtask: () => void
}

export class TitleCell {
  el: HTMLTableCellElement

  constructor(parentRow: HTMLElement, props: TitleCellProps) {
    const { task } = props
    this.el = parentRow.createEl('td', { cls: 'pm-table-cell-title' })
    renderTreeGuides(this.el, props.treeGuides, props.isLastChild)
    const inner = this.el.createDiv('pm-table-title-inner')

    const titleSpan = inner.createSpan({ text: task.title, cls: 'pm-task-title-text' })
    titleSpan.addEventListener('click', () => props.onTitleClick())
    titleSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation()
      makeInlineEdit({
        container: inner,
        display: titleSpan,
        inputType: 'text',
        value: task.title,
        onSave: props.onTitleSave
      })
    })

    new IconButton(inner)
      .setIcon('plus')
      .setTooltip('Add subtask')
      .setRevealOnHover(true)
      .onClick((e) => {
        e.stopPropagation()
        props.onAddSubtask()
      })

    if (task.type === 'milestone') {
      new Chip(inner)
        .setLabel('M')
        .setVariant('solid')
        .setSize('sm')
        .setColor('var(--color-purple)')
        .setTooltip('Milestone')
    }
    if (task.type === 'subtask') {
      new Chip(inner)
        .setLabel('Sub')
        .setVariant('solid')
        .setSize('sm')
        .setColor('var(--color-green)')
        .setTooltip('Subtask')
    }
    if (task.recurrence) {
      new Chip(inner)
        .setLabel('R')
        .setVariant('solid')
        .setSize('sm')
        .setColor('var(--color-blue)')
        .setTooltip('Recurring')
    }
    if (task.archived) {
      new Chip(inner)
        .setLabel('Archived')
        .setVariant('solid')
        .setSize('sm')
        .setColor('var(--text-muted)')
        .setTooltip('Archived')
    }

    if (task.tags.length) {
      const tagRow = inner.createDiv('pm-table-tags')
      for (const tag of task.tags) {
        renderTagChip(tagRow, tag, props.showTagColors)
      }
    }
  }
}

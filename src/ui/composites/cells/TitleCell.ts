import type { Task } from '../../../types'
import { Chip } from '../../primitives/Chip'
import { IconButton } from '../../primitives/IconButton'
import { renderTagChip } from '../tagChip'
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

    const titleSpan = this.el.createSpan({ text: task.title, cls: 'pm-task-title-text' })
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
      new Chip(this.el)
        .setLabel('M')
        .setVariant('solid')
        .setSize('sm')
        .setColor('var(--color-purple)')
        .setTooltip('Milestone')
    }
    if (task.type === 'subtask') {
      new Chip(this.el)
        .setLabel('Sub')
        .setVariant('solid')
        .setSize('sm')
        .setColor('var(--color-green)')
        .setTooltip('Subtask')
    }
    if (task.recurrence) {
      new Chip(this.el)
        .setLabel('R')
        .setVariant('solid')
        .setSize('sm')
        .setColor('var(--color-blue)')
        .setTooltip('Recurring')
    }
    if (task.archived) {
      new Chip(this.el)
        .setLabel('Archived')
        .setVariant('solid')
        .setSize('sm')
        .setColor('var(--text-muted)')
        .setTooltip('Archived')
    }

    if (task.tags.length) {
      const tagRow = this.el.createDiv('pm-table-tags')
      for (const tag of task.tags) {
        renderTagChip(tagRow, tag, props.showTagColors)
      }
    }
  }
}

function renderTreeGuides(cell: HTMLElement, guides: boolean[] | null, isLastChild: boolean): void {
  if (!guides?.length) return
  const elbow = guides.length - 1
  for (let level = 0; level < guides.length; level++) {
    if (level !== elbow && !guides[level]) continue
    const cls = level === elbow ? 'pm-tree-guide pm-tree-guide--elbow' : 'pm-tree-guide'
    const guide = cell.createSpan({ cls })
    if (level === elbow && isLastChild) guide.addClass('pm-tree-guide--last')
    guide.style.setProperty('--level', String(level))
  }
}

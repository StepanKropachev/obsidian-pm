import { AvatarStack, type AvatarPerson } from '../primitives/AvatarStack'
import { Chip } from '../primitives/Chip'
import { CollapseToggle } from '../primitives/CollapseToggle'
import { IconButton } from '../primitives/IconButton'
import { ProgressBar } from '../primitives/ProgressBar'
import { renderDueChip, type DueUrgency } from './dueChip'
import { renderTreeGuides } from './treeGuides'

export interface ProjectRowProps {
  title: string
  icon: string
  color: string
  depth: number
  /** One entry per indent column: does an ancestor at that column still have rows below it. Null draws no connectors. */
  treeGuides: boolean[] | null
  isLastChild: boolean
  /** Sub-projects below this one. Above zero, the counts are the caller's subtree rollup. */
  childCount: number
  collapsed: boolean
  tasksDone: number
  tasksTotal: number
  overdue: number
  members: AvatarPerson[]
  /** Formatted by the caller; empty when nothing in the project has a date. */
  dueLabel: string
  dueUrgency: DueUrgency
  onToggleCollapsed: () => void
  onClick: () => void
  onContextMenu: (e: MouseEvent) => void
  onActions: (e: MouseEvent) => void
}

const ROW_IGNORE_SELECTOR = 'button, .pm-chip--interactive, .pm-icon-btn, .pm-collapse-toggle'

export class ProjectRow {
  el: HTMLTableRowElement

  constructor(tbody: HTMLElement, props: ProjectRowProps) {
    this.el = tbody.createEl('tr', { cls: 'pm-table-row pm-project-row' })
    this.el.style.setProperty('--depth', String(props.depth))

    const expand = this.el.createEl('td', { cls: 'pm-table-cell-expand' })
    if (props.childCount > 0) {
      new CollapseToggle(expand, {
        collapsed: props.collapsed,
        onToggle: () => props.onToggleCollapsed(),
        subject: 'sub-projects'
      })
    }

    const title = this.el.createEl('td', { cls: 'pm-table-cell-title' })
    renderTreeGuides(title, props.treeGuides, props.isLastChild)
    const inner = title.createDiv('pm-table-title-inner')
    inner.createSpan({ text: props.icon, cls: 'pm-project-row-icon' })
    inner.createSpan({ text: props.title, cls: 'pm-task-title-text' })

    const progress = this.el.createEl('td', { cls: 'pm-table-cell pm-table-cell-progress' })
    new ProgressBar(progress)
      .setSize('sm')
      .setValue(props.tasksTotal ? (props.tasksDone / props.tasksTotal) * 100 : 0)
      .setColor(props.color)
      .setShowLabel(true)

    const tasks = this.el.createEl('td', { cls: 'pm-table-cell' })
    tasks.createSpan({ cls: 'pm-project-row-tasks', text: `${props.tasksDone}/${props.tasksTotal}` })
    if (props.overdue > 0) {
      new Chip(tasks)
        .setLabel(`${props.overdue} overdue`)
        .setVariant('solid')
        .setColor('var(--color-red)')
        .setSize('sm')
        .setStrong()
    }

    const members = this.el.createEl('td', { cls: 'pm-table-cell pm-table-cell-assignees' })
    new AvatarStack(members).setPeople(props.members).setMax(3).setSize('sm')

    const due = this.el.createEl('td', { cls: 'pm-table-cell' })
    if (props.dueLabel) renderDueChip(due, props.dueLabel, props.dueUrgency, 'sm')
    else due.createSpan({ cls: 'pm-project-row-empty', text: '—' })

    const actions = this.el.createEl('td', { cls: 'pm-table-cell pm-table-cell-actions' })
    new IconButton(actions)
      .setIcon('more-horizontal')
      .setTooltip('Project actions')
      .setRevealOnHover(true)
      .onClick((e) => props.onActions(e))

    this.el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      if (target.closest(ROW_IGNORE_SELECTOR)) return
      props.onClick()
    })
    this.el.addEventListener('contextmenu', (e) => props.onContextMenu(e))
  }
}

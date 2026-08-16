import { ProgressBar } from '../primitives/ProgressBar'
import { CollapseToggle } from '../primitives/CollapseToggle'
import { Chip } from '../primitives/Chip'

export interface ProjectCardProps {
  title: string
  icon: string
  color: string
  tasksDone: number
  tasksTotal: number
  /** Sub-projects below this one. Above zero, the counts above cover the whole subtree. */
  childCount: number
  collapsed: boolean
  onToggleCollapsed: () => void
  onClick: () => void
  onContextMenu: (e: MouseEvent) => void
}

export class ProjectCard {
  el: HTMLElement

  constructor(parentEl: HTMLElement, props: ProjectCardProps) {
    const card = parentEl.createDiv('pm-project-card')
    this.el = card

    const colorBar = card.createDiv('pm-project-card-bar')
    colorBar.setCssStyles({ background: props.color })

    const body = card.createDiv('pm-project-card-body')
    const head = body.createDiv('pm-project-card-head')
    if (props.childCount > 0) {
      const toggle = new CollapseToggle(head, {
        collapsed: props.collapsed,
        onToggle: () => props.onToggleCollapsed(),
        subject: 'sub-projects'
      })
      toggle.el.addEventListener('click', (e) => e.stopPropagation())
    }
    head.createDiv({ text: props.icon, cls: 'pm-project-card-icon' })

    body.createEl('h3', { text: props.title, cls: 'pm-project-card-title' })

    const meta = body.createDiv('pm-project-card-meta')
    meta.createSpan({
      text: `${props.tasksDone}/${props.tasksTotal} tasks`,
      cls: 'pm-project-card-tasks'
    })
    if (props.childCount > 0) {
      new Chip(meta)
        .setLabel(`${props.childCount} sub-project${props.childCount === 1 ? '' : 's'}`)
        .setVariant('plain')
        .setSize('sm')
    }

    const percent = props.tasksTotal ? (props.tasksDone / props.tasksTotal) * 100 : 0
    new ProgressBar(body).setSize('sm').setValue(percent).setColor(props.color)

    card.addEventListener('click', () => props.onClick())
    card.addEventListener('contextmenu', (e) => props.onContextMenu(e))
  }
}

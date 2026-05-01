import { ProgressBar } from '../primitives/ProgressBar'

export interface ProjectCardProps {
  title: string
  icon: string
  color: string
  tasksDone: number
  tasksTotal: number
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
    body.createEl('div', { text: props.icon, cls: 'pm-project-card-icon' })
    body.createEl('h3', { text: props.title, cls: 'pm-project-card-title' })

    const meta = body.createDiv('pm-project-card-meta')
    meta.createEl('span', {
      text: `${props.tasksDone}/${props.tasksTotal} tasks`,
      cls: 'pm-project-card-tasks'
    })

    const percent = props.tasksTotal ? (props.tasksDone / props.tasksTotal) * 100 : 0
    new ProgressBar(body).setSize('sm').setValue(percent).setColor(props.color)

    card.addEventListener('click', () => props.onClick())
    card.addEventListener('contextmenu', (e) => props.onContextMenu(e))
  }
}

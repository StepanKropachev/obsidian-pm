import { setIcon } from 'obsidian'

export interface CollapseToggleProps {
  collapsed: boolean
  onToggle: (e: MouseEvent) => unknown
}

export class CollapseToggle {
  el: HTMLElement

  constructor(parentEl: HTMLElement, props: CollapseToggleProps) {
    this.el = parentEl.createDiv({ cls: 'tree-item-icon collapse-icon pm-collapse-toggle' })
    setIcon(this.el, 'right-triangle')
    this.el.toggleClass('is-collapsed', props.collapsed)
    this.el.setAttr('aria-label', props.collapsed ? 'Expand subtasks' : 'Collapse subtasks')
    this.el.addEventListener('click', props.onToggle)
  }
}

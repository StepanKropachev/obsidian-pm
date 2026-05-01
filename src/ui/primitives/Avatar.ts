import { setTooltip } from 'obsidian'
import { stringToColor } from '../../utils'

export class Avatar {
  el: HTMLSpanElement

  constructor(parentEl: HTMLElement) {
    this.el = parentEl.createEl('span', { cls: 'pm-avatar' })
  }

  setName(name: string): this {
    this.el.setText(name.slice(0, 2).toUpperCase())
    this.el.style.background = stringToColor(name)
    setTooltip(this.el, name)
    return this
  }

  setSize(size: 'md' | 'sm'): this {
    this.el.toggleClass('pm-avatar--sm', size === 'sm')
    return this
  }
}

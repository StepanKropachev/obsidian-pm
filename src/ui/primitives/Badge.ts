import { setTooltip } from 'obsidian'

export class Badge {
  el: HTMLElement

  constructor(parentEl: HTMLElement) {
    this.el = parentEl.createEl('span', { cls: 'pm-badge' })
  }

  setLabel(text: string): this {
    this.el.setText(text)
    return this
  }

  setColor(color: string): this {
    this.el.style.setProperty('--pm-badge-color', color)
    return this
  }

  setSize(size: 'md' | 'sm'): this {
    this.el.toggleClass('pm-badge--sm', size === 'sm')
    return this
  }

  setTooltip(text: string): this {
    setTooltip(this.el, text)
    return this
  }

  onClick(handler: (e: MouseEvent) => unknown): this {
    this.el.addClass('pm-badge--interactive')
    this.el.addEventListener('click', handler)
    return this
  }
}

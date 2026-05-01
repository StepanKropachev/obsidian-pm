export class Pill {
  el: HTMLButtonElement

  constructor(parentEl: HTMLElement) {
    this.el = parentEl.createEl('button', { cls: 'pm-pill' })
  }

  setLabel(text: string): this {
    this.el.setText(text)
    return this
  }

  setActive(active: boolean): this {
    this.el.toggleClass('pm-pill--active', active)
    return this
  }

  setShape(shape: 'rounded' | 'pill'): this {
    this.el.toggleClass('pm-pill--pill', shape === 'pill')
    return this
  }

  setAriaLabel(label: string): this {
    this.el.setAttribute('aria-label', label)
    return this
  }

  onClick(callback: (e: MouseEvent) => unknown): this {
    this.el.addEventListener('click', callback)
    return this
  }

  onContextMenu(callback: (e: MouseEvent) => unknown): this {
    this.el.addEventListener('contextmenu', callback)
    return this
  }
}

export class Pill {
  buttonEl: HTMLButtonElement

  constructor(parentEl: HTMLElement) {
    this.buttonEl = parentEl.createEl('button', { cls: 'pm-pill' })
  }

  setLabel(text: string): this {
    this.buttonEl.setText(text)
    return this
  }

  setActive(active: boolean): this {
    this.buttonEl.toggleClass('pm-pill--active', active)
    return this
  }

  setShape(shape: 'rounded' | 'pill'): this {
    this.buttonEl.toggleClass('pm-pill--pill', shape === 'pill')
    return this
  }

  setAriaLabel(label: string): this {
    this.buttonEl.setAttribute('aria-label', label)
    return this
  }

  onClick(callback: (e: MouseEvent) => unknown): this {
    this.buttonEl.addEventListener('click', callback)
    return this
  }

  onContextMenu(callback: (e: MouseEvent) => unknown): this {
    this.buttonEl.addEventListener('contextmenu', callback)
    return this
  }
}

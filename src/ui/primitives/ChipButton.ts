import { ButtonComponent } from 'obsidian'

export class ChipButton {
  el: HTMLButtonElement
  private button: ButtonComponent

  constructor(parentEl: HTMLElement) {
    this.button = new ButtonComponent(parentEl)
    this.el = this.button.buttonEl
    this.el.addClass('pm-chip-btn')
  }

  setLabel(text: string): this {
    this.button.setButtonText(text)
    return this
  }

  setActive(active: boolean): this {
    this.el.toggleClass('pm-chip-btn--active', active)
    return this
  }

  setShape(shape: 'rounded' | 'pill'): this {
    this.el.toggleClass('pm-chip-btn--pill', shape === 'pill')
    return this
  }

  setAriaLabel(label: string): this {
    this.el.setAttribute('aria-label', label)
    return this
  }

  onClick(handler: (e: MouseEvent) => unknown): this {
    this.button.onClick(handler)
    return this
  }

  onContextMenu(handler: (e: MouseEvent) => unknown): this {
    this.el.addEventListener('contextmenu', handler)
    return this
  }
}

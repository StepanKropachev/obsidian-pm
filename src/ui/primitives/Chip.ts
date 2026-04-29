import { setIcon } from 'obsidian'

export class Chip {
  el: HTMLElement
  private labelEl: HTMLElement
  private rmBtn: HTMLButtonElement | null = null

  constructor(parentEl: HTMLElement) {
    this.el = parentEl.createEl('span', { cls: 'pm-chip' })
    this.labelEl = this.el.createEl('span', { cls: 'pm-chip-label' })
  }

  setLabel(text: string): this {
    this.labelEl.setText(text)
    return this
  }

  setVariant(variant: 'default' | 'accent'): this {
    this.el.toggleClass('pm-chip--accent', variant === 'accent')
    return this
  }

  setShape(shape: 'rounded' | 'pill'): this {
    this.el.toggleClass('pm-chip--pill', shape === 'pill')
    return this
  }

  setSize(size: 'md' | 'sm'): this {
    this.el.toggleClass('pm-chip--sm', size === 'sm')
    return this
  }

  setTooltip(text: string): this {
    this.el.setAttribute('title', text)
    return this
  }

  setRemovable(onRemove: () => void): this {
    if (!this.rmBtn) {
      this.rmBtn = this.el.createEl('button', { cls: 'pm-chip-rm' })
      setIcon(this.rmBtn, 'x')
    }
    this.rmBtn.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      onRemove()
    }
    return this
  }
}

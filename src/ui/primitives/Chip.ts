import { setIcon, setTooltip } from 'obsidian'

export class Chip {
  el: HTMLElement
  private labelEl: HTMLElement

  constructor(parentEl: HTMLElement) {
    this.el = parentEl.createEl('span', { cls: 'pm-chip' })
    this.labelEl = this.el.createSpan()
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
    setTooltip(this.el, text)
    return this
  }

  setRemovable(onRemove: () => void): this {
    const rmBtn = this.el.createEl('button', { cls: 'pm-chip-rm' })
    setIcon(rmBtn, 'x')
    rmBtn.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      onRemove()
    }
    return this
  }
}

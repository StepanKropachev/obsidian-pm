import { setIcon, setTooltip } from 'obsidian'

export type ChipVariant = 'solid' | 'outline' | 'plain'

export class Chip {
  el: HTMLElement
  private labelEl: HTMLElement
  private dotEl: HTMLElement | null = null

  constructor(parentEl: HTMLElement) {
    this.el = parentEl.createSpan({ cls: 'pm-chip' })
    this.labelEl = this.el.createSpan({ cls: 'pm-chip-label' })
  }

  setLabel(text: string): this {
    this.labelEl.setText(text)
    return this
  }

  setColor(color: string): this {
    this.el.style.setProperty('--pm-chip-color', color)
    return this
  }

  setVariant(variant: ChipVariant): this {
    this.el.toggleClass('pm-chip--solid', variant === 'solid')
    this.el.toggleClass('pm-chip--outline', variant === 'outline')
    this.el.toggleClass('pm-chip--plain', variant === 'plain')
    return this
  }

  setDot(show = true): this {
    if (show && !this.dotEl) {
      this.dotEl = this.el.createSpan({ cls: 'pm-chip-dot' })
      this.el.prepend(this.dotEl)
    } else if (!show && this.dotEl) {
      this.dotEl.remove()
      this.dotEl = null
    }
    return this
  }

  setTag(isTag = true): this {
    this.el.toggleClass('pm-chip--tag', isTag)
    return this
  }

  setStrong(strong = true): this {
    this.el.toggleClass('pm-chip--strong', strong)
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

  onClick(handler: (e: MouseEvent) => unknown): this {
    this.el.addClass('pm-chip--interactive')
    this.el.addEventListener('click', handler)
    return this
  }
}

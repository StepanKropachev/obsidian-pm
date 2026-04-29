export class ProgressBar {
  el: HTMLDivElement
  private fill: HTMLDivElement
  private labelEl: HTMLElement | null = null

  constructor(parentEl: HTMLElement) {
    this.el = parentEl.createDiv('pm-progress')
    const track = this.el.createDiv('pm-progress-track')
    this.fill = track.createDiv('pm-progress-fill')
  }

  setValue(percent: number): this {
    const clamped = Math.max(0, Math.min(100, percent))
    this.fill.style.width = `${clamped}%`
    if (this.labelEl) this.labelEl.setText(`${Math.round(clamped)}%`)
    return this
  }

  setColor(color: string): this {
    this.el.style.setProperty('--pm-progress-color', color)
    return this
  }

  setSize(size: 'sm' | 'md'): this {
    this.el.toggleClass('pm-progress--sm', size === 'sm')
    return this
  }

  setShowLabel(show: boolean): this {
    if (show && !this.labelEl) {
      this.labelEl = this.el.createEl('span', { cls: 'pm-progress-label', text: '0%' })
    } else if (!show && this.labelEl) {
      this.labelEl.remove()
      this.labelEl = null
    }
    return this
  }
}

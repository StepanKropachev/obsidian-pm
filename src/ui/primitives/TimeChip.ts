export class TimeChip {
  el: HTMLElement

  constructor(parentEl: HTMLElement) {
    this.el = parentEl.createEl('span', { cls: 'pm-time-chip' })
  }

  setHours(logged: number, estimate?: number): this {
    const est = estimate ?? 0
    this.el.setText(est > 0 ? `${logged}/${est}h` : `${logged}h`)
    this.el.toggleClass('pm-time-chip--over', est > 0 && logged > est)
    return this
  }

  setSize(size: 'md' | 'sm'): this {
    this.el.toggleClass('pm-time-chip--sm', size === 'sm')
    return this
  }
}

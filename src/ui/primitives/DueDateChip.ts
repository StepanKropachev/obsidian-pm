export class DueDateChip {
  el: HTMLElement
  private urgencyClass: string | null = null

  constructor(parentEl: HTMLElement) {
    this.el = parentEl.createEl('span', { cls: 'pm-due-chip' })
  }

  setLabel(text: string): this {
    this.el.setText(text)
    return this
  }

  setVariant(variant: 'chip' | 'label'): this {
    this.el.toggleClass('pm-due-chip--label', variant === 'label')
    return this
  }

  setUrgency(urgency: 'normal' | 'near' | 'overdue'): this {
    if (this.urgencyClass) {
      this.el.removeClass(this.urgencyClass)
      this.urgencyClass = null
    }
    if (urgency === 'near') this.urgencyClass = 'pm-due-chip--near'
    else if (urgency === 'overdue') this.urgencyClass = 'pm-due-chip--overdue'
    if (this.urgencyClass) this.el.addClass(this.urgencyClass)
    return this
  }

  setPlaceholder(isPlaceholder: boolean): this {
    this.el.toggleClass('pm-due-chip--placeholder', isPlaceholder)
    return this
  }

  onClick(callback: (e: MouseEvent) => unknown): this {
    this.el.addClass('pm-due-chip--interactive')
    this.el.addEventListener('click', callback)
    return this
  }
}

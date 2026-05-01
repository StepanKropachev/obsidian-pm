export class DueDateChip {
  el: HTMLElement

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
    this.el.toggleClass('pm-due-chip--near', urgency === 'near')
    this.el.toggleClass('pm-due-chip--overdue', urgency === 'overdue')
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

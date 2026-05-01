export interface ViewSwitcherOption<T extends string> {
  id: T
  icon: string
  label: string
}

export interface ViewSwitcherProps<T extends string> {
  options: ViewSwitcherOption<T>[]
  active: T
  onChange: (id: T) => void
}

export class ViewSwitcher<T extends string> {
  el: HTMLElement

  constructor(parentEl: HTMLElement, props: ViewSwitcherProps<T>) {
    this.el = parentEl.createDiv('pm-view-switcher')
    for (const opt of props.options) {
      const btn = this.el.createEl('button', {
        cls: 'pm-view-btn',
        attr: { 'aria-label': `Switch to ${opt.label} view` }
      })
      btn.createEl('span', { text: opt.icon, cls: 'pm-view-btn-icon' })
      btn.createEl('span', { text: opt.label })
      if (opt.id === props.active) btn.addClass('pm-view-btn--active')
      btn.addEventListener('click', () => {
        this.el.querySelectorAll('.pm-view-btn').forEach((b) => b.removeClass('pm-view-btn--active'))
        btn.addClass('pm-view-btn--active')
        props.onChange(opt.id)
      })
    }
  }
}

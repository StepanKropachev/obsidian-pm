export interface SegmentedOption<T extends string> {
  id: T
  label: string
  cls?: string
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[]
  active: T
  onChange: (id: T) => void
}

export class SegmentedControl<T extends string> {
  el: HTMLElement

  constructor(parentEl: HTMLElement, props: SegmentedControlProps<T>) {
    this.el = parentEl.createDiv('pm-segmented')
    for (const opt of props.options) {
      const btn = this.el.createEl('button', { cls: 'pm-segmented-btn', text: opt.label })
      if (opt.cls) btn.addClass(opt.cls)
      if (opt.id === props.active) btn.addClass('pm-segmented-btn--active')
      btn.addEventListener('click', () => {
        this.el.querySelectorAll('.pm-segmented-btn').forEach((b) => b.removeClass('pm-segmented-btn--active'))
        btn.addClass('pm-segmented-btn--active')
        props.onChange(opt.id)
      })
    }
  }
}

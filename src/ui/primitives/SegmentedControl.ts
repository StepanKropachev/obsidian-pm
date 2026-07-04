import { ButtonComponent } from 'obsidian'

export interface SegmentedOption<T extends string> {
  id: T
  label: string
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
    const buttons = new Map<T, ButtonComponent>()
    for (const opt of props.options) {
      const btn = new ButtonComponent(this.el).setButtonText(opt.label).onClick(() => {
        for (const [id, b] of buttons) {
          if (id === opt.id) b.setCta()
          else b.removeCta()
        }
        props.onChange(opt.id)
      })
      if (opt.id === props.active) btn.setCta()
      buttons.set(opt.id, btn)
    }
  }
}

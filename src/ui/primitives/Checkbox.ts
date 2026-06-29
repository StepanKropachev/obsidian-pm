import { setIcon } from 'obsidian'

/** A square toggle that shows an accent check when on. Clicking toggles it and fires onChange. */
export class Checkbox {
  el: HTMLButtonElement
  private value = false
  private changeHandler?: (checked: boolean) => void

  constructor(parent: HTMLElement) {
    this.el = parent.createEl('button', { cls: 'pm-checkbox', attr: { role: 'checkbox' } })
    setIcon(this.el, 'check')
    this.el.addEventListener('click', () => {
      this.setChecked(!this.value)
      this.changeHandler?.(this.value)
    })
  }

  setChecked(checked: boolean): this {
    this.value = checked
    this.el.toggleClass('is-checked', checked)
    this.el.setAttribute('aria-checked', String(checked))
    return this
  }

  onChange(handler: (checked: boolean) => void): this {
    this.changeHandler = handler
    return this
  }
}

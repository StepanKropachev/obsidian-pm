import { setIcon } from 'obsidian'
import { Popover } from '../../primitives/Popover'
import { formatDate, relativeDue, today } from '../../../dates'

export interface DateControlOpts {
  container: HTMLElement
  value: string
  onChange: (value: string) => void
  emptyLabel?: string
}

/**
 * Inline date control: shows the formatted date with a relative-due hint, opening a popover
 * with a native date input plus Today / Clear shortcuts. Backs Due, Start, and Completed.
 */
export function renderDateControl(opts: DateControlOpts): void {
  const has = !!opts.value
  const trigger = opts.container.createEl('button', { cls: 'pm-prop-inline' })
  if (!has) trigger.addClass('pm-prop-inline--empty')
  const icon = trigger.createSpan({ cls: 'pm-glyph-icon' })
  setIcon(icon, 'calendar')
  trigger.createSpan({
    cls: 'pm-prop-inline-label',
    text: has ? formatDate(opts.value) : (opts.emptyLabel ?? 'Set date')
  })
  const rel = relativeDue(opts.value)
  if (rel) trigger.createSpan({ cls: `pm-due pm-due--${rel.tone}`, text: rel.text })

  let pop: Popover | null = null
  trigger.addEventListener('click', () => {
    if (pop?.isOpen) {
      pop.close()
      return
    }
    // The value to commit on close. A native date input fires `change` the moment its
    // value is valid again, which for an already-set date means after the first edited
    // segment — committing there would re-render the modal and yank focus to the title
    // mid-edit. Instead the popover reports the final value once, when it closes (the
    // user clicks away, presses Enter, or picks Today/Clear), so manual editing is free.
    let next: string | null = null
    pop = new Popover({
      anchor: trigger,
      width: 160,
      onClose: () => {
        pop = null
        const value = next ?? field.value
        if (value !== opts.value) opts.onChange(value)
      }
    })
    const field = pop.contentEl.createEl('input', { type: 'date', cls: 'pm-pop-field' })
    field.value = opts.value
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        pop?.close()
      }
    })
    const actions = pop.contentEl.createDiv('pm-pop-actions')
    const todayBtn = actions.createEl('button', { cls: 'pm-pop-item pm-pop-item--center', text: 'Today' })
    todayBtn.addEventListener('click', () => {
      next = today().toString()
      pop?.close()
    })
    if (has) {
      const clearBtn = actions.createEl('button', {
        cls: 'pm-pop-item pm-pop-item--center pm-pop-item--danger',
        text: 'Clear'
      })
      clearBtn.addEventListener('click', () => {
        next = ''
        pop?.close()
      })
    }
    pop.open()
    field.focus()
  })
}

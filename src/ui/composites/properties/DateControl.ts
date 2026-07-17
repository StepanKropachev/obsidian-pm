import { setIcon } from 'obsidian'
import { CalendarPicker } from '../../primitives/CalendarPicker'
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
    // The value to commit on close. The calendar reports the chosen day once, and the
    // popover commits it on close (a day click, or Today/Clear) — so a single change
    // reaches the modal instead of an intermediate stream that would yank focus mid-edit.
    let next: string | null = null
    pop = new Popover({
      anchor: trigger,
      width: 260,
      onClose: () => {
        pop = null
        if (next !== null && next !== opts.value) opts.onChange(next)
      }
    })
    new CalendarPicker(pop.contentEl).setValue(opts.value).onChange((value) => {
      next = value
      pop?.close()
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
  })
}

import { makeInlineEdit } from '../cells/inlineEdit'

export interface InputControlOpts {
  container: HTMLElement
  value: string
  onChange: (value: string) => void
  inputType?: 'text' | 'number' | 'date'
  suffix?: string
  placeholder?: string
  number?: { min?: number; max?: number }
}

/**
 * Inline input control: shows the current value and swaps to a native input on click.
 * `number` rounds and clamps the committed value and is read only when `inputType` is
 * 'number'. Backs Progress.
 */
export function renderInputControl(opts: InputControlOpts): void {
  const inputType = opts.inputType ?? 'text'
  const has = opts.value !== ''
  const trigger = opts.container.createEl('button', { cls: 'pm-prop-inline' })
  if (!has) trigger.addClass('pm-prop-inline--empty')
  trigger.createSpan({
    cls: 'pm-prop-inline-label',
    text: has ? `${opts.value}${opts.suffix ?? ''}` : (opts.placeholder ?? 'Set value')
  })

  trigger.addEventListener('click', () => {
    makeInlineEdit({
      container: opts.container,
      display: trigger,
      inputType,
      value: opts.value,
      onSave: async (v) => {
        opts.onChange(inputType === 'number' && opts.number ? clampNumber(v, opts.number) : v)
      }
    })
  })
}

function clampNumber(raw: string, bounds: { min?: number; max?: number }): string {
  const rounded = Math.round(parseFloat(raw) || 0)
  return String(Math.min(bounds.max ?? Infinity, Math.max(bounds.min ?? -Infinity, rounded)))
}

import { safeAsync } from '../../../utils'

export interface InlineEditOpts {
  container: HTMLElement
  display: HTMLElement
  inputType: 'text' | 'date'
  value: string
  onSave: (newValue: string) => Promise<void>
}

export function makeInlineEdit(opts: InlineEditOpts): void {
  const { container, display, inputType, value, onSave } = opts
  const input = container.createEl('input', { type: inputType, cls: 'pm-inline-edit', value })
  display.replaceWith(input)
  input.focus()
  if (inputType === 'text') input.select()

  let saved = false
  const save = safeAsync(async () => {
    if (saved) return
    saved = true
    const newVal = input.value.trim()
    if (newVal !== value) {
      await onSave(newVal)
    } else {
      input.replaceWith(display)
    }
  })

  input.addEventListener('blur', save)
  if (inputType === 'text') {
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') save()
      if (ev.key === 'Escape') input.replaceWith(display)
    })
  } else {
    input.addEventListener('change', save)
  }
}

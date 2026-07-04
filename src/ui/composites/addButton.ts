import { setIcon } from 'obsidian'

/** Ghost "+ label" add button, the pm-prop-add pattern shared by every add row. */
export function renderAddButton(
  parent: HTMLElement,
  label: string,
  onClick: (e: MouseEvent) => void
): HTMLButtonElement {
  const btn = parent.createEl('button', { cls: 'pm-prop-add' })
  setIcon(btn.createSpan({ cls: 'pm-glyph-icon' }), 'plus')
  btn.createSpan({ cls: 'pm-prop-add-label', text: label })
  btn.addEventListener('click', onClick)
  return btn
}

import { setIcon } from 'obsidian'

export function renderPropRow(
  container: HTMLElement,
  label: string,
  valueBuilder: () => HTMLElement,
  icon?: string
): HTMLElement {
  const row = container.createDiv('pm-prop-row')
  const labelEl = row.createSpan({ cls: 'pm-prop-label' })
  if (icon) {
    labelEl.addClass('pm-prop-label--with-icon')
    const iconEl = labelEl.createSpan({ cls: 'pm-prop-label-icon' })
    setIcon(iconEl, icon)
    labelEl.createSpan({ text: label })
  } else {
    labelEl.setText(label)
  }
  const valueEl = valueBuilder()
  row.appendChild(valueEl)
  return row
}

/**
 * Render a labeled property row (label + value) used in modals.
 */
export function renderPropRow(container: HTMLElement, label: string, valueBuilder: () => HTMLElement): HTMLElement {
  const row = container.createDiv('pm-prop-row')
  row.createEl('span', { text: label, cls: 'pm-prop-label' })
  const valueEl = valueBuilder()
  row.appendChild(valueEl)
  return row
}

/**
 * Render a chip list with remove buttons and an add button.
 * Used for assignees, tags, dependencies, etc.
 */
export function renderChipList(
  container: HTMLElement,
  items: string[],
  opts: {
    chipCls: string
    rmCls: string
    onRemove: (item: string) => void
    labelFn?: (item: string) => string
    onAdd?: (e: MouseEvent) => void
    addLabel?: string
    renderAdd?: (container: HTMLElement) => void
  }
): void {
  container.empty()
  for (const item of items) {
    const chip = container.createEl('span', { cls: opts.chipCls })
    chip.setText(opts.labelFn ? opts.labelFn(item) : item)
    const rm = chip.createEl('button', { text: '\u2715', cls: opts.rmCls })
    rm.addEventListener('click', () => opts.onRemove(item))
  }
  if (opts.renderAdd) {
    opts.renderAdd(container)
  } else if (opts.onAdd) {
    const addBtn = container.createEl('button', { text: opts.addLabel ?? '+ Add', cls: 'pm-prop-add-btn' })
    addBtn.addEventListener('click', (e) => opts.onAdd!(e))
  }
}

/**
 * Render a progress slider with label.
 */
export function renderProgressSlider(
  container: HTMLElement,
  value: number,
  onChange: (value: number) => void
): HTMLElement {
  const wrap = container.createDiv('pm-prop-value pm-prop-progress-wrap')
  const slider = wrap.createEl('input', { type: 'range', cls: 'pm-progress-slider' })
  slider.min = '0'
  slider.max = '100'
  slider.step = '5'
  slider.value = String(value)
  const label = wrap.createEl('span', { text: `${value}%`, cls: 'pm-progress-slider-label' })
  slider.addEventListener('input', () => {
    const v = parseInt(slider.value)
    label.textContent = `${v}%`
    onChange(v)
  })
  return wrap
}

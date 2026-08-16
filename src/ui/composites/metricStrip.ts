export interface MetricStat {
  label: string
  value: string
  sub?: string
  /** Rendered beside the value: a progress bar, a chip, whatever the caller composes. */
  extra?: (parent: HTMLElement) => void
  alert?: boolean
}

/** The stats row at the top of a project overview: one bordered shell, one cell per stat. */
export function renderMetricStrip(parent: HTMLElement, stats: MetricStat[]): HTMLElement {
  const strip = parent.createDiv('pm-metric-strip')
  for (const stat of stats) {
    const cell = strip.createDiv('pm-metric')
    cell.createDiv({ cls: 'pm-metric-label', text: stat.label })
    const value = cell.createDiv('pm-metric-value')
    if (stat.alert) value.addClass('pm-metric-value--alert')
    if (stat.value) value.createSpan({ text: stat.value })
    stat.extra?.(value)
    if (stat.sub) cell.createDiv({ cls: 'pm-metric-sub', text: stat.sub })
  }
  return strip
}

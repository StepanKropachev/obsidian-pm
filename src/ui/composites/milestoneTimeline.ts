export interface MilestonePoint {
  name: string
  dateLabel: string
  /** Where the milestone sits on the track, 0-100. */
  pos: number
  state: 'done' | 'next' | 'plan'
}

const LABEL_WIDTH = 104
const SLOT_WIDTH = 112
const MIN_WIDTH = 320

/**
 * Date-proportional milestone dots on one track, with a dashed marker for today.
 * A label closer than one label-width to the previous one drops to a second row.
 */
export function renderMilestoneTimeline(
  parent: HTMLElement,
  points: MilestonePoint[],
  todayPos: number | null
): HTMLElement {
  const scroller = parent.createDiv('pm-timeline-scroll')
  const timeline = scroller.createDiv('pm-timeline')
  const width = Math.max(points.length * SLOT_WIDTH, MIN_WIDTH)
  timeline.style.setProperty('--pm-timeline-min-width', `${width}px`)
  timeline.createDiv('pm-timeline-track')

  if (todayPos !== null && todayPos >= 0 && todayPos <= 100) {
    const marker = timeline.createDiv('pm-timeline-today')
    marker.style.setProperty('--pm-timeline-pos', `${todayPos}%`)
    marker.createSpan({ cls: 'pm-timeline-today-label', text: 'Today' })
  }

  const gap = (LABEL_WIDTH / width) * 100
  let lastTop = -gap
  let hasLowRow = false
  for (const point of points) {
    const low = point.pos - lastTop < gap
    if (low) hasLowRow = true
    else lastTop = point.pos

    const item = timeline.createDiv(`pm-timeline-item pm-timeline-item--${point.state}`)
    item.style.setProperty('--pm-timeline-pos', `${point.pos}%`)
    if (low) item.addClass('pm-timeline-item--low')
    if (point.pos < 7) item.addClass('pm-timeline-item--start')
    else if (point.pos > 93) item.addClass('pm-timeline-item--end')

    item.createDiv('pm-timeline-dot')
    const label = item.createDiv('pm-timeline-label')
    label.createDiv({ cls: 'pm-timeline-name', text: point.name })
    label.createDiv({ cls: 'pm-timeline-date', text: point.dateLabel })
  }
  if (hasLowRow) timeline.addClass('pm-timeline--two-rows')
  return timeline
}

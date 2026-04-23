import type { Task, GanttGranularity } from '../../types'
import { flattenTasks } from '../../store/TaskTreeOps'
import { Temporal, today, parsePlainDate } from '../../dates'

export const ROW_HEIGHT = 44
export const HEADER_HEIGHT = 56
export const LABEL_WIDTH = 280
export const BAR_PADDING = 8
export const BAR_BORDER_RADIUS = 7

export const DAY_WIDTH: Record<GanttGranularity, number> = {
  day: 44,
  week: 22,
  month: 9,
  quarter: 5
}

export interface TimelineCfg {
  startDate: Temporal.PlainDate
  endDate: Temporal.PlainDate
  dayWidth: number
  granularity: GanttGranularity
  totalDays: number
  totalWidth: number
}

const MIN_DAYS: Record<GanttGranularity, number> = {
  day: 30,
  week: 90,
  month: 365,
  quarter: 365
}

export function buildTimelineConfig(tasks: Task[], granularity: GanttGranularity): TimelineCfg {
  const allTasks = flattenTasks(tasks).map((f) => f.task)
  const dates: Temporal.PlainDate[] = []

  for (const t of allTasks) {
    const start = parsePlainDate(t.start)
    const due = parsePlainDate(t.due)
    if (start) dates.push(start)
    if (due) dates.push(due)
  }

  const now = today()
  dates.push(now)

  let startDate = dates.reduce((min, d) => (Temporal.PlainDate.compare(d, min) < 0 ? d : min), dates[0])
  let endDate = dates.reduce((max, d) => (Temporal.PlainDate.compare(d, max) > 0 ? d : max), dates[0])

  // Add padding
  startDate = startDate.subtract({ days: 7 })
  endDate = endDate.add({ days: 14 })

  // Enforce minimum visible range based on granularity
  const currentSpan = endDate.since(startDate, { largestUnit: 'days' }).days
  if (currentSpan < MIN_DAYS[granularity]) {
    const extra = Math.ceil((MIN_DAYS[granularity] - currentSpan) / 2)
    startDate = startDate.subtract({ days: extra })
    endDate = endDate.add({ days: extra })
  }

  // Snap to month start for cleaner headers
  if (granularity === 'week' || granularity === 'month' || granularity === 'quarter') {
    startDate = startDate.with({ day: 1 })
  }

  const dayWidth = DAY_WIDTH[granularity]
  const totalDays = endDate.since(startDate, { largestUnit: 'days' }).days
  return {
    startDate,
    endDate,
    dayWidth,
    granularity,
    totalDays,
    totalWidth: totalDays * dayWidth
  }
}

export function dateToX(cfg: TimelineCfg, date: Temporal.PlainDate): number {
  return date.since(cfg.startDate, { largestUnit: 'days' }).days * cfg.dayWidth
}

export function xToDate(cfg: TimelineCfg, x: number): Temporal.PlainDate {
  return cfg.startDate.add({ days: Math.round(x / cfg.dayWidth) })
}

/**
 * Returns snap-point X positions for the given granularity.
 * - day: every day border
 * - week: every Monday + mid-week (Thursday)
 * - month: 1st, ~8th, ~15th, ~22nd of each month
 * - quarter: 1st of each month
 */
export function getSnapPoints(cfg: TimelineCfg): number[] {
  const points: number[] = []
  const { startDate, totalDays, dayWidth, granularity } = cfg

  for (let i = 0; i <= totalDays; i++) {
    const d = startDate.add({ days: i })
    const x = i * dayWidth

    if (granularity === 'day') {
      points.push(x)
    } else if (granularity === 'week') {
      // Temporal dayOfWeek: Mon=1..Sun=7
      if (d.dayOfWeek === 1 || d.dayOfWeek === 4) points.push(x)
    } else if (granularity === 'month') {
      if (d.day === 1 || d.day === 8 || d.day === 15 || d.day === 22) points.push(x)
    } else if (granularity === 'quarter') {
      if (d.day === 1) points.push(x)
    }
  }
  return points
}

/** Snap an x position to the nearest snap point within a threshold. */
export function snapX(x: number, snapPoints: number[], threshold: number): number {
  let closest = x
  let minDist = Infinity
  for (const sp of snapPoints) {
    const dist = Math.abs(x - sp)
    if (dist < minDist) {
      minDist = dist
      closest = sp
    }
    if (sp > x + threshold) break // snap points are sorted, no need to continue
  }
  return minDist <= threshold ? closest : x
}

export function getWeekNumber(d: Temporal.PlainDate): number {
  return d.weekOfYear ?? 0
}

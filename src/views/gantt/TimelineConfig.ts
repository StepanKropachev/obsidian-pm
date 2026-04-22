import type { Task, GanttGranularity } from '../../types'
import { flattenTasks } from '../../store/TaskTreeOps'

export const DAY_MS = 86400_000
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
  startDate: Date
  endDate: Date
  dayWidth: number
  granularity: GanttGranularity
  totalDays: number
  totalWidth: number
}

export function buildTimelineConfig(tasks: Task[], granularity: GanttGranularity): TimelineCfg {
  const allTasks = flattenTasks(tasks).map((f) => f.task)
  const dates: Date[] = []

  for (const t of allTasks) {
    if (t.start) dates.push(new Date(t.start))
    if (t.due) dates.push(new Date(t.due))
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  dates.push(today)

  let startDate = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : today
  let endDate = dates.length
    ? new Date(Math.max(...dates.map((d) => d.getTime())))
    : new Date(today.getTime() + 30 * DAY_MS)

  // Add padding
  startDate = new Date(startDate.getTime() - 7 * DAY_MS)
  endDate = new Date(endDate.getTime() + 14 * DAY_MS)

  // Enforce minimum visible range based on granularity
  const minDays: Record<GanttGranularity, number> = {
    day: 30,
    week: 90,
    month: 365,
    quarter: 365
  }
  const currentSpan = (endDate.getTime() - startDate.getTime()) / DAY_MS
  if (currentSpan < minDays[granularity]) {
    const extra = (minDays[granularity] - currentSpan) / 2
    startDate = new Date(startDate.getTime() - extra * DAY_MS)
    endDate = new Date(endDate.getTime() + extra * DAY_MS)
  }

  // Snap to month start for cleaner headers
  if (granularity === 'week' || granularity === 'month' || granularity === 'quarter') {
    startDate.setDate(1)
  }

  const dayWidth = DAY_WIDTH[granularity]
  const totalDays = calendarDayDiff(startDate, endDate)
  return {
    startDate,
    endDate,
    dayWidth,
    granularity,
    totalDays,
    totalWidth: totalDays * dayWidth
  }
}

/** Calendar-day difference, DST-safe (uses UTC noon to dodge transitions). */
function calendarDayDiff(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate(), 12)
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate(), 12)
  return Math.round((b - a) / DAY_MS)
}

export function dateToX(cfg: TimelineCfg, date: Date): number {
  return calendarDayDiff(cfg.startDate, date) * cfg.dayWidth
}

export function xToDate(cfg: TimelineCfg, x: number): Date {
  const days = Math.round(x / cfg.dayWidth)
  return new Date(cfg.startDate.getFullYear(), cfg.startDate.getMonth(), cfg.startDate.getDate() + days)
}

export function dateToIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
    const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i)
    const x = i * dayWidth

    if (granularity === 'day') {
      points.push(x)
    } else if (granularity === 'week') {
      const dow = d.getDay()
      if (dow === 1 || dow === 4) points.push(x) // Monday, Thursday
    } else if (granularity === 'month') {
      const day = d.getDate()
      if (day === 1 || day === 8 || day === 15 || day === 22) points.push(x)
    } else if (granularity === 'quarter') {
      if (d.getDate() === 1) points.push(x)
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

export function getWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

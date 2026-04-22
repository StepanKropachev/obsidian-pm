import type { RendererContext } from './GanttRenderer'
import { HEADER_HEIGHT, dateToX, getWeekNumber } from './TimelineConfig'
import { svgEl } from '../../utils'
import { Temporal } from '../../dates'

import type { GanttWeekLabel } from '../../types'

// ─── Week label formatting ────────────────────────────────────────────────

function formatDateRange(weekStart: Temporal.PlainDate, days: number): string {
  const end = weekStart.add({ days: days - 1 })
  const startMonth = weekStart.toLocaleString(undefined, { month: 'short' })
  if (weekStart.month === end.month) {
    return `${startMonth} ${weekStart.day}–${end.day}`
  }
  const endMonth = end.toLocaleString(undefined, { month: 'short' })
  return `${startMonth} ${weekStart.day} – ${endMonth} ${end.day}`
}

function formatWeekLabel(weekStart: Temporal.PlainDate, days: number, weekNum: number, mode: GanttWeekLabel): string {
  if (mode === 'weekNumber') return `W${weekNum}`
  const range = formatDateRange(weekStart, days)
  if (mode === 'dateRange') return range
  return `W${weekNum}: ${range}`
}

// ─── Timeline header ───────────────────────────────────────────────────────

export function renderTimelineHeader(ctx: RendererContext): void {
  const g = svgEl('g', { class: 'pm-gantt-header' })

  g.appendChild(
    svgEl('rect', {
      x: 0,
      y: 0,
      width: ctx.cfg.totalWidth,
      height: HEADER_HEIGHT,
      class: 'pm-gantt-header-bg'
    })
  )

  const { granularity } = ctx.cfg
  if (granularity === 'day') renderDayHeader(g, ctx)
  else if (granularity === 'week') renderWeekHeader(g, ctx)
  else if (granularity === 'month') renderMonthHeader(g, ctx)
  else renderQuarterHeader(g, ctx)

  ctx.svgEl.appendChild(g)
}

function renderDayHeader(g: SVGGElement, ctx: RendererContext): void {
  const { startDate, totalDays, dayWidth } = ctx.cfg
  renderMonthBands(g, 0, 24, ctx)
  for (let i = 0; i < totalDays; i++) {
    const d = startDate.add({ days: i })
    const x = i * dayWidth
    const isWeekend = d.dayOfWeek === 6 || d.dayOfWeek === 7
    if (isWeekend) {
      g.appendChild(
        svgEl('rect', {
          x,
          y: 24,
          width: dayWidth,
          height: HEADER_HEIGHT - 24,
          class: 'pm-gantt-weekend-header'
        })
      )
    }
    if (dayWidth >= 20) {
      const text = svgEl('text', {
        x: x + dayWidth / 2,
        y: 42,
        class: 'pm-gantt-header-day'
      })
      text.textContent = String(d.day)
      g.appendChild(text)
    }
  }
}

function renderWeekHeader(g: SVGGElement, ctx: RendererContext): void {
  const { startDate, totalDays, dayWidth } = ctx.cfg
  renderMonthBands(g, 0, 24, ctx)

  // Align to actual Mondays so header ticks match grid lines
  const offsetToMonday = startDate.dayOfWeek === 1 ? 0 : 8 - startDate.dayOfWeek

  const labelMode = ctx.plugin.settings.ganttWeekLabel

  // Partial first week (before the first Monday)
  if (offsetToMonday > 0) {
    const weekNum = getWeekNumber(startDate)
    const w = offsetToMonday * dayWidth
    const text = svgEl('text', {
      x: w / 2,
      y: 44,
      class: 'pm-gantt-header-week'
    })
    text.textContent = formatWeekLabel(startDate, offsetToMonday, weekNum, labelMode)
    g.appendChild(text)
  }

  // Full weeks from each Monday
  let i = offsetToMonday
  while (i < totalDays) {
    const d = startDate.add({ days: i })
    const weekNum = getWeekNumber(d)
    const x = i * dayWidth
    const daysInWeek = Math.min(7, totalDays - i)
    const w = daysInWeek * dayWidth
    const text = svgEl('text', {
      x: x + w / 2,
      y: 44,
      class: 'pm-gantt-header-week'
    })
    text.textContent = formatWeekLabel(d, daysInWeek, weekNum, labelMode)
    g.appendChild(text)
    g.appendChild(
      svgEl('line', {
        x1: x,
        y1: 24,
        x2: x,
        y2: HEADER_HEIGHT,
        class: 'pm-gantt-header-tick'
      })
    )
    i += 7
  }
}

function renderMonthHeader(g: SVGGElement, ctx: RendererContext): void {
  renderYearBands(g, 0, 24, ctx)
  let monthStart = ctx.cfg.startDate.with({ day: 1 })
  while (Temporal.PlainDate.compare(monthStart, ctx.cfg.endDate) < 0) {
    const nextMonthStart = monthStart.add({ months: 1 })
    const x1 = Math.max(0, dateToX(ctx.cfg, monthStart))
    const x2 = Math.min(ctx.cfg.totalWidth, dateToX(ctx.cfg, nextMonthStart))
    const w = x2 - x1
    const text = svgEl('text', {
      x: x1 + w / 2,
      y: 44,
      class: 'pm-gantt-header-month'
    })
    text.textContent = monthStart.toLocaleString(undefined, { month: 'short' })
    g.appendChild(text)
    g.appendChild(
      svgEl('line', {
        x1,
        y1: 24,
        x2: x1,
        y2: HEADER_HEIGHT,
        class: 'pm-gantt-header-tick'
      })
    )
    monthStart = nextMonthStart
  }
}

function renderQuarterHeader(g: SVGGElement, ctx: RendererContext): void {
  renderYearBands(g, 0, 24, ctx)
  const { startDate } = ctx.cfg
  let date = Temporal.PlainDate.from({
    year: startDate.year,
    month: Math.floor((startDate.month - 1) / 3) * 3 + 1,
    day: 1
  })
  while (Temporal.PlainDate.compare(date, ctx.cfg.endDate) < 0) {
    const q = Math.floor((date.month - 1) / 3) + 1
    const nextQStart = date.add({ months: 3 })
    const x1 = Math.max(0, dateToX(ctx.cfg, date))
    const x2 = Math.min(ctx.cfg.totalWidth, dateToX(ctx.cfg, nextQStart))
    const text = svgEl('text', {
      x: x1 + (x2 - x1) / 2,
      y: 44,
      class: 'pm-gantt-header-quarter'
    })
    text.textContent = `Q${q} ${date.year}`
    g.appendChild(text)
    date = nextQStart
  }
}

function renderMonthBands(g: SVGGElement, y: number, h: number, ctx: RendererContext): void {
  let monthStart = ctx.cfg.startDate.with({ day: 1 })
  while (Temporal.PlainDate.compare(monthStart, ctx.cfg.endDate) < 0) {
    const nextMonthStart = monthStart.add({ months: 1 })
    const x1 = Math.max(0, dateToX(ctx.cfg, monthStart))
    const x2 = Math.min(ctx.cfg.totalWidth, dateToX(ctx.cfg, nextMonthStart))
    const w = x2 - x1
    g.appendChild(
      svgEl('rect', {
        x: x1,
        y,
        width: w,
        height: h,
        class: (monthStart.month - 1) % 2 === 0 ? 'pm-gantt-band-even' : 'pm-gantt-band-odd'
      })
    )
    const text = svgEl('text', {
      x: x1 + 6,
      y: y + h - 6,
      class: 'pm-gantt-header-month-top'
    })
    text.textContent = monthStart.toLocaleString(undefined, { month: 'short', year: '2-digit' })
    g.appendChild(text)
    monthStart = nextMonthStart
  }
}

function renderYearBands(g: SVGGElement, y: number, h: number, ctx: RendererContext): void {
  let date = Temporal.PlainDate.from({ year: ctx.cfg.startDate.year, month: 1, day: 1 })
  while (Temporal.PlainDate.compare(date, ctx.cfg.endDate) < 0) {
    const yearEnd = date.add({ years: 1 })
    const x1 = Math.max(0, dateToX(ctx.cfg, date))
    const x2 = Math.min(ctx.cfg.totalWidth, dateToX(ctx.cfg, yearEnd))
    g.appendChild(
      svgEl('rect', {
        x: x1,
        y,
        width: x2 - x1,
        height: h,
        class: date.year % 2 === 0 ? 'pm-gantt-band-even' : 'pm-gantt-band-odd'
      })
    )
    const text = svgEl('text', {
      x: x1 + 6,
      y: y + h - 6,
      class: 'pm-gantt-header-year'
    })
    text.textContent = String(date.year)
    g.appendChild(text)
    date = yearEnd
  }
}

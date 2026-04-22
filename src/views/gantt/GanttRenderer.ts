import type PMPlugin from '../../main'
import type { Project } from '../../types'
import type { FlatTask } from '../../store/TaskTreeOps'
import type { TimelineCfg } from './TimelineConfig'
import { ROW_HEIGHT, HEADER_HEIGHT, dateToX } from './TimelineConfig'
import { svgEl, todayMidnight } from '../../utils'
import type { DragState } from './GanttDragHandler'
import type { LinkState } from './GanttLinkHandler'

export { renderTimelineHeader } from './GanttHeaderRenderer'
export { renderTaskBar, renderMilestoneLabels, renderDependencyArrows } from './GanttTaskBarRenderer'

export interface RendererContext {
  svgEl: SVGSVGElement
  cfg: TimelineCfg
  plugin: PMPlugin
  project: Project
  flatTasks: FlatTask[]
  drag: DragState
  link: LinkState
  onRefresh: () => Promise<void>
  cleanupFns: (() => void)[]
}

// ─── Grid lines ────────────────────────────────────────────────────────────

export function renderGridLines(ctx: RendererContext, totalRows: number): void {
  const g = svgEl('g', { class: 'pm-gantt-grid' })

  const totalHeight = HEADER_HEIGHT + totalRows * ROW_HEIGHT
  const { startDate, totalDays, dayWidth, granularity } = ctx.cfg

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i)
    const x = i * dayWidth
    const isWeekend = d.getDay() === 0 || d.getDay() === 6
    const isMonday = d.getDay() === 1
    const isFirst = d.getDate() === 1

    if (isWeekend && granularity === 'day') {
      g.appendChild(
        svgEl('rect', {
          x,
          y: HEADER_HEIGHT,
          width: dayWidth,
          height: totalHeight - HEADER_HEIGHT,
          class: 'pm-gantt-weekend'
        })
      )
    }

    const shouldDrawLine =
      (granularity === 'day' && isMonday) ||
      (granularity === 'week' && isMonday) ||
      (granularity === 'month' && isFirst) ||
      (granularity === 'quarter' && isFirst && d.getMonth() % 3 === 0)

    if (shouldDrawLine) {
      g.appendChild(
        svgEl('line', {
          x1: x,
          y1: HEADER_HEIGHT,
          x2: x,
          y2: totalHeight,
          class: 'pm-gantt-gridline-v'
        })
      )
    }
  }

  for (let r = 0; r <= totalRows; r++) {
    const y = HEADER_HEIGHT + r * ROW_HEIGHT
    g.appendChild(
      svgEl('line', {
        x1: 0,
        y1: y,
        x2: ctx.cfg.totalWidth,
        y2: y,
        class: 'pm-gantt-gridline-h'
      })
    )
  }

  ctx.svgEl.appendChild(g)
}

// ─── Today line ────────────────────────────────────────────────────────────

export function renderTodayLine(ctx: RendererContext, svgHeight: number): void {
  const today = todayMidnight()
  const x = dateToX(ctx.cfg, today)
  if (x < 0 || x > ctx.cfg.totalWidth) return

  const g = svgEl('g', { class: 'pm-gantt-today-group' })

  g.appendChild(
    svgEl('line', {
      x1: x,
      y1: HEADER_HEIGHT - 8,
      x2: x,
      y2: svgHeight,
      class: 'pm-gantt-today-line'
    })
  )

  g.appendChild(
    svgEl('polygon', {
      points: `${x},${HEADER_HEIGHT - 16} ${x + 6},${HEADER_HEIGHT - 8} ${x},${HEADER_HEIGHT} ${x - 6},${HEADER_HEIGHT - 8}`,
      class: 'pm-gantt-today-diamond'
    })
  )

  ctx.svgEl.appendChild(g)
}

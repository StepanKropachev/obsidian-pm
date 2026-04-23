import { Notice } from 'obsidian'
import type { Task } from '../../types'
import { flattenTasks, filterArchived, filterDone } from '../../store/TaskTreeOps'
import { openTaskModal } from '../../ui/ModalFactory'
import { COLOR_ACCENT } from '../../constants'
import { svgEl, getStatusConfig, safeAsync } from '../../utils'
import { parsePlainDate } from '../../dates'
import {
  ROW_HEIGHT,
  HEADER_HEIGHT,
  BAR_PADDING,
  BAR_BORDER_RADIUS,
  dateToX,
  xToDate,
  getSnapPoints,
  snapX
} from './TimelineConfig'
import { attachDragHandle, attachBarMove } from './GanttDragHandler'
import { handleLinkDotClick } from './GanttLinkHandler'
import type { RendererContext } from './GanttRenderer'

// ─── Task bars ─────────────────────────────────────────────────────────────

export function renderTaskBar(g: SVGGElement, task: Task, row: number, _depth: number, ctx: RendererContext): void {
  const startDate = parsePlainDate(task.start)
  const endDate = parsePlainDate(task.due)
  if (!startDate && !endDate) {
    renderEmptyRowClickTarget(g, task, row, ctx)
    return
  }

  const statusConfig = getStatusConfig(ctx.plugin.settings.statuses, task.status)
  const color = statusConfig?.color ?? COLOR_ACCENT
  const rowY = HEADER_HEIGHT + row * ROW_HEIGHT
  const y = rowY + BAR_PADDING
  const height = ROW_HEIGHT - BAR_PADDING * 2

  // Row hover background
  g.appendChild(
    svgEl('rect', {
      x: 0,
      y: rowY,
      width: ctx.cfg.totalWidth,
      height: ROW_HEIGHT,
      class: 'pm-gantt-row-hover'
    })
  )

  // Milestone → render diamond
  if (task.type === 'milestone') {
    renderMilestoneDiamond(g, task, row, color, ctx)
    return
  }

  // Normal task bar. A task with end date E occupies the day E, so the bar
  // right edge sits at the start of E+1.
  const effectiveStart = startDate ?? endDate!
  const effectiveEnd = (endDate ?? effectiveStart).add({ days: 1 })

  const x = Math.max(0, dateToX(ctx.cfg, effectiveStart))
  const xEnd = Math.min(ctx.cfg.totalWidth, dateToX(ctx.cfg, effectiveEnd))
  const width = Math.max(8, xEnd - x)

  // Group for bar + handles
  const barGroup = svgEl('g', { class: 'pm-gantt-bar-group' })
  g.appendChild(barGroup)

  // Main bar — flat fill, no gradient/shadow/sheen
  const rect = svgEl('rect', {
    x,
    y,
    width,
    height,
    rx: BAR_BORDER_RADIUS,
    ry: BAR_BORDER_RADIUS,
    fill: color,
    opacity: 0.75,
    class: 'pm-gantt-bar'
  })
  barGroup.appendChild(rect)

  // Progress overlay
  if (task.progress > 0 && task.progress < 100) {
    const pw = (task.progress / 100) * width
    barGroup.appendChild(
      svgEl('rect', {
        x,
        y,
        width: pw,
        height,
        rx: BAR_BORDER_RADIUS,
        ry: BAR_BORDER_RADIUS,
        fill: color,
        opacity: 0.35,
        class: 'pm-gantt-bar-progress'
      })
    )
  }

  // Subtask stripe
  if (task.subtasks.length > 0) {
    barGroup.appendChild(
      svgEl('rect', {
        x,
        y: y + height - 3,
        width,
        height: 3,
        rx: 1.5,
        fill: color,
        opacity: 0.5
      })
    )
  }

  // Recurrence indicator
  if (task.recurrence) {
    const icon = svgEl('text', {
      x: x + width + 4,
      y: y + height / 2 + 5,
      class: 'pm-gantt-bar-icon'
    })
    icon.textContent = 'R'
    barGroup.appendChild(icon)
  }

  // Label inside bar
  if (width > 55) {
    const label = svgEl('text', {
      x: x + 8,
      y: y + height / 2 + 5,
      class: 'pm-gantt-bar-label'
    })
    const maxChars = Math.max(4, Math.floor((width - 16) / 7.5))
    label.textContent = task.title.length > maxChars ? task.title.slice(0, maxChars - 1) + '\u2026' : task.title
    barGroup.appendChild(label)
  }

  // Tooltip
  const ttEl = svgEl('title', {})
  const assigneesStr = task.assignees.length ? `\nAssignees: ${task.assignees.join(', ')}` : ''
  ttEl.textContent = `${task.title}\n${statusConfig?.label ?? task.status} \u00b7 ${task.priority}\nStart: ${task.start || '\u2014'}  Due: ${task.due || '\u2014'}\nProgress: ${task.progress}%${assigneesStr}`
  rect.appendChild(ttEl)

  // Drag handles
  const HANDLE_W = 8
  for (const side of ['left', 'right'] as const) {
    const hx = side === 'left' ? x : x + width - HANDLE_W
    const handle = svgEl('rect', {
      x: hx,
      y,
      width: HANDLE_W,
      height,
      rx: 3,
      ry: 3,
      class: 'pm-gantt-drag-handle',
      cursor: 'ew-resize'
    })
    const cleanup = attachDragHandle(
      handle,
      side,
      task,
      rect,
      barGroup,
      x,
      width,
      ctx.cfg,
      ctx.drag,
      ctx.plugin,
      ctx.project,
      ctx.onRefresh
    )
    ctx.cleanupFns.push(cleanup)
    barGroup.appendChild(handle)
  }

  // Link dots (dependency connectors) — positioned outside bar edges
  const DOT_R = 4
  const DOT_GAP = 4
  for (const side of ['left', 'right'] as const) {
    const cx = side === 'left' ? x - DOT_GAP - DOT_R : x + width + DOT_GAP + DOT_R
    const cy = y + height / 2
    const dot = svgEl('circle', {
      cx,
      cy,
      r: DOT_R,
      class: 'pm-gantt-link-dot',
      cursor: 'crosshair'
    })
    dot.addEventListener('mousedown', (e: MouseEvent) => {
      e.stopPropagation()
    })
    dot.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation()
      handleLinkDotClick(dot, task.id, side, ctx.link, ctx.plugin, ctx.project, ctx.onRefresh)
    })
    barGroup.appendChild(dot)
  }

  // Move whole bar by dragging (only when both dates exist)
  if (task.start && task.due) {
    const moveCleanup = attachBarMove(
      rect,
      barGroup,
      task,
      x,
      width,
      ctx.cfg,
      ctx.drag,
      ctx.plugin,
      ctx.project,
      ctx.onRefresh
    )
    ctx.cleanupFns.push(moveCleanup)
    rect.setAttribute('cursor', 'grab')
  } else {
    rect.setAttribute('cursor', 'pointer')
  }

  // Click to open modal (suppressed if drag occurred)
  rect.addEventListener('click', () => {
    if (ctx.drag.dragMoved) {
      ctx.drag.dragMoved = false
      return
    }
    openTaskModal(ctx.plugin, ctx.project, { task, onSave: () => ctx.onRefresh() })
  })
}

// ─── Empty row click-to-set-dates ─────────────────────────────────────────

function renderEmptyRowClickTarget(g: SVGGElement, task: Task, row: number, ctx: RendererContext): void {
  const rowY = HEADER_HEIGHT + row * ROW_HEIGHT

  // Invisible rect covering the full row — acts as click target
  const hitArea = svgEl('rect', {
    x: 0,
    y: rowY,
    width: ctx.cfg.totalWidth,
    height: ROW_HEIGHT,
    fill: 'transparent',
    cursor: 'cell',
    class: 'pm-gantt-empty-row-hit'
  })

  // Hover preview bar (hidden until mouseover)
  const previewY = rowY + BAR_PADDING
  const previewH = ROW_HEIGHT - BAR_PADDING * 2
  const previewW = Math.max(ctx.cfg.dayWidth, 8)
  const preview = svgEl('rect', {
    x: 0,
    y: previewY,
    width: previewW,
    height: previewH,
    rx: BAR_BORDER_RADIUS,
    ry: BAR_BORDER_RADIUS,
    class: 'pm-gantt-empty-row-preview',
    'pointer-events': 'none'
  })
  preview.classList.add('pm-hidden')

  g.appendChild(hitArea)
  g.appendChild(preview)

  const snapPoints = getSnapPoints(ctx.cfg)
  const snapThreshold = ctx.cfg.dayWidth * 0.4

  // Track mouse to position the preview bar
  hitArea.addEventListener('mousemove', (e: MouseEvent) => {
    const svgRect = ctx.svgEl.getBoundingClientRect()
    const rawX = e.clientX - svgRect.left
    const snapped = snapX(rawX, snapPoints, snapThreshold)
    preview.setAttribute('x', String(snapped))
    preview.classList.remove('pm-hidden')
  })

  hitArea.addEventListener('mouseleave', () => {
    preview.classList.add('pm-hidden')
  })

  // Click to set start=due=clicked date and save
  hitArea.addEventListener(
    'click',
    safeAsync(async (e: MouseEvent) => {
      const svgRect = ctx.svgEl.getBoundingClientRect()
      const rawX = e.clientX - svgRect.left
      const snapped = snapX(rawX, snapPoints, snapThreshold)
      const iso = xToDate(ctx.cfg, snapped).toString()

      try {
        await ctx.plugin.store.updateTask(ctx.project, task.id, { start: iso, due: iso })
      } catch (err) {
        new Notice('Failed to set task dates. Please try again.')
        console.error('GanttTaskBarRenderer: click-to-set-dates failed', err)
        return
      }
      if (ctx.plugin.settings.autoSchedule) {
        await ctx.plugin.store.scheduleAfterChange(ctx.project, task.id, ctx.plugin.settings.statuses)
      }
      await ctx.onRefresh()
    })
  )

  // Tooltip
  const tt = svgEl('title', {})
  tt.textContent = 'Click to set dates'
  hitArea.appendChild(tt)
}

// ─── Milestone diamond ────────────────────────────────────────────────────

function renderMilestoneDiamond(g: SVGGElement, task: Task, row: number, color: string, ctx: RendererContext): void {
  const date = parsePlainDate(task.due) ?? parsePlainDate(task.start)
  if (!date) return

  const cx = dateToX(ctx.cfg, date) + ctx.cfg.dayWidth / 2
  const cy = HEADER_HEIGHT + row * ROW_HEIGHT + ROW_HEIGHT / 2
  const size = 12

  const pts = `${cx},${cy - size} ${cx + size},${cy} ${cx},${cy + size} ${cx - size},${cy}`
  const diamond = svgEl('polygon', {
    points: pts,
    fill: color,
    opacity: 0.8,
    class: 'pm-gantt-milestone',
    cursor: 'pointer'
  })
  g.appendChild(diamond)

  const tt = svgEl('title', {})
  tt.textContent = `${task.title} (milestone)\nDate: ${task.due || task.start || '\u2014'}`
  diamond.appendChild(tt)

  diamond.addEventListener('click', () => {
    openTaskModal(ctx.plugin, ctx.project, { task, onSave: () => ctx.onRefresh() })
  })
}

// ─── Milestone labels ─────────────────────────────────────────────────────

export function renderMilestoneLabels(ctx: RendererContext): void {
  const all = flattenTasks(ctx.project.tasks)
  const milestones = all.filter((f) => f.task.type === 'milestone' && (f.task.due || f.task.start))
  if (!milestones.length) return

  const labelsG = svgEl('g', { class: 'pm-gantt-milestone-labels' })

  for (const { task } of milestones) {
    const date = parsePlainDate(task.due) ?? parsePlainDate(task.start)
    if (!date) continue
    const x = dateToX(ctx.cfg, date) + ctx.cfg.dayWidth / 2
    const statusConfig = getStatusConfig(ctx.plugin.settings.statuses, task.status)
    const color = statusConfig?.color ?? COLOR_ACCENT

    const totalH = HEADER_HEIGHT + ctx.flatTasks.filter((f) => f.visible || f.depth === 0).length * ROW_HEIGHT
    labelsG.appendChild(
      svgEl('line', {
        x1: x,
        y1: HEADER_HEIGHT,
        x2: x,
        y2: totalH,
        stroke: color,
        'stroke-width': 1,
        'stroke-dasharray': '4 4',
        opacity: 0.4
      })
    )

    const label = svgEl('text', {
      x,
      y: 14,
      'text-anchor': 'middle',
      class: 'pm-gantt-milestone-label',
      fill: color
    })
    label.textContent = task.title.length > 16 ? task.title.slice(0, 14) + '\u2026' : task.title
    labelsG.appendChild(label)
  }

  ctx.svgEl.appendChild(labelsG)
}

// ─── Dependency arrows ─────────────────────────────────────────────────────

export function renderDependencyArrows(ctx: RendererContext): void {
  let activeTasks = filterArchived(ctx.project.tasks)
  if (ctx.plugin.settings.ganttHideDone) activeTasks = filterDone(activeTasks, ctx.plugin.settings.statuses)
  const allFlat = flattenTasks(activeTasks)
  const indexMap = new Map<string, number>()
  let visibleRow = 0
  const countVisible = (tasks: Task[]) => {
    for (const t of tasks) {
      indexMap.set(t.id, visibleRow)
      visibleRow++
      if (!t.collapsed) countVisible(t.subtasks)
    }
  }
  countVisible(activeTasks)

  const arrowGroup = svgEl('g', { class: 'pm-gantt-arrows' })

  for (const { task } of allFlat) {
    if (!task.dependencies?.length) continue
    const toRow = indexMap.get(task.id)
    if (toRow === undefined) continue
    const toY = HEADER_HEIGHT + toRow * ROW_HEIGHT + ROW_HEIGHT / 2
    const taskStart = parsePlainDate(task.start)
    if (!taskStart) continue
    const toX = dateToX(ctx.cfg, taskStart)

    for (const depId of task.dependencies) {
      const fromRow = indexMap.get(depId)
      if (fromRow === undefined) continue
      const depTask = allFlat.find((f) => f.task.id === depId)?.task
      const depDue = depTask ? parsePlainDate(depTask.due) : null
      if (!depDue) continue
      const fromX = dateToX(ctx.cfg, depDue.add({ days: 1 }))
      const fromY = HEADER_HEIGHT + fromRow * ROW_HEIGHT + ROW_HEIGHT / 2

      const midX = (fromX + toX) / 2
      arrowGroup.appendChild(
        svgEl('path', {
          d: `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`,
          class: 'pm-gantt-arrow',
          'marker-end': 'url(#pm-arrowhead)'
        })
      )
    }
  }

  // Arrowhead marker
  const defs = getOrCreateDefs(ctx.svgEl)
  const marker = svgEl('marker', {
    id: 'pm-arrowhead',
    markerWidth: 8,
    markerHeight: 8,
    refX: 6,
    refY: 3,
    orient: 'auto'
  })
  marker.appendChild(
    svgEl('path', {
      d: 'M0,0 L0,6 L8,3 z',
      class: 'pm-gantt-arrowhead'
    })
  )
  defs.appendChild(marker)

  ctx.svgEl.appendChild(arrowGroup)
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getOrCreateDefs(el: SVGSVGElement): SVGDefsElement {
  return (
    (el.querySelector('defs') as SVGDefsElement) ??
    (() => {
      const d = svgEl('defs', {})
      el.insertBefore(d, el.firstChild)
      return d
    })()
  )
}

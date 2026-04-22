import type PMPlugin from '../../main'
import type { Project, Task, GanttGranularity } from '../../types'
import { type FlatTask, flattenTasks, filterArchived, filterDone } from '../../store/TaskTreeOps'
import { openTaskModal } from '../../ui/ModalFactory'
import type { SubView } from '../SubView'
import type { TimelineCfg } from './TimelineConfig'
import { buildTimelineConfig, dateToX, xToDate, HEADER_HEIGHT, ROW_HEIGHT, LABEL_WIDTH } from './TimelineConfig'
import { makeDragState } from './GanttDragHandler'
import type { DragState } from './GanttDragHandler'
import { makeLinkState, cancelLink } from './GanttLinkHandler'
import type { LinkState } from './GanttLinkHandler'
import {
  renderTimelineHeader,
  renderGridLines,
  renderTodayLine,
  renderTaskBar,
  renderDependencyArrows,
  renderMilestoneLabels
} from './GanttRenderer'
import { svgEl } from '../../utils'
import type { RendererContext } from './GanttRenderer'
import { renderTaskLabel } from './TaskLabelRenderer'

export class GanttView implements SubView {
  private granularity: GanttGranularity
  private scrollEl!: HTMLElement
  private svgEl!: SVGSVGElement
  private flatTasks: FlatTask[] = []
  private cfg!: TimelineCfg
  private drag: DragState = makeDragState()
  private link: LinkState = makeLinkState()
  private labelWidth: number = LABEL_WIDTH

  getLabelWidth(): number {
    return this.labelWidth
  }
  setLabelWidth(w: number): void {
    this.labelWidth = w
  }
  private cleanupFns: (() => void)[] = []
  private pendingScroll: { top: number; anchorDate: Date } | null = null

  constructor(
    private container: HTMLElement,
    private project: Project,
    private plugin: PMPlugin,
    private onRefresh: () => Promise<void>
  ) {
    this.granularity = plugin.settings.ganttGranularity
  }

  destroy(): void {
    for (const fn of this.cleanupFns) fn()
    this.cleanupFns = []
  }

  getScrollPosition(): { top: number; anchorDate: Date } {
    const top = this.scrollEl?.scrollTop ?? 0
    const anchorDate = this.scrollEl ? xToDate(this.cfg, this.scrollEl.scrollLeft) : new Date()
    return { top, anchorDate }
  }

  setPendingScroll(pos: { top: number; anchorDate: Date }): void {
    this.pendingScroll = pos
  }

  render(): void {
    this.cleanupFns.forEach((fn) => fn())
    this.cleanupFns = []
    cancelLink(this.link)
    this.container.empty()
    this.container.addClass('pm-gantt-view')

    const activeTasks = this.getVisibleTasks()
    this.flatTasks = flattenTasks(activeTasks).filter((f) => f.visible || f.depth === 0)
    this.cfg = buildTimelineConfig(activeTasks, this.granularity)

    this.renderGranularityControls()
    this.renderGantt()
  }

  private renderGranularityControls(): void {
    const bar = this.container.createDiv('pm-gantt-controls')
    const levels: GanttGranularity[] = ['day', 'week', 'month', 'quarter']
    const labels: Record<GanttGranularity, string> = { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter' }

    for (const level of levels) {
      const btn = bar.createEl('button', { text: labels[level], cls: 'pm-gantt-zoom-btn' })
      if (level === this.granularity) btn.addClass('pm-gantt-zoom-btn--active')
      btn.addEventListener('click', () => {
        this.granularity = level
        this.plugin.settings.ganttGranularity = level
        void this.plugin.saveSettings()
        this.render()
      })
    }

    bar.createEl('span', { cls: 'pm-gantt-sep' })
    const todayBtn = bar.createEl('button', { text: 'Today', cls: 'pm-btn pm-btn-ghost pm-gantt-today-btn' })
    todayBtn.addEventListener('click', () => this.scrollToToday())

    const expBtn = bar.createEl('button', { text: 'Expand all', cls: 'pm-btn pm-btn-ghost' })
    expBtn.addEventListener('click', () => this.setAllCollapsed(false))
    const colBtn = bar.createEl('button', { text: 'Collapse all', cls: 'pm-btn pm-btn-ghost' })
    colBtn.addEventListener('click', () => this.setAllCollapsed(true))

    bar.createEl('span', { cls: 'pm-gantt-sep' })
    const hideDone = this.plugin.settings.ganttHideDone
    const toggleBtn = bar.createEl('button', {
      text: hideDone ? 'Show completed' : 'Hide completed',
      cls: 'pm-btn pm-btn-ghost'
    })
    if (hideDone) toggleBtn.addClass('pm-gantt-toggle-active')
    toggleBtn.addEventListener('click', () => {
      this.plugin.settings.ganttHideDone = !this.plugin.settings.ganttHideDone
      void this.plugin.saveSettings()
      this.render()
    })
  }

  private renderGantt(): void {
    const wrapper = this.container.createDiv('pm-gantt-wrapper')

    // Left panel: task labels
    const leftPanel = wrapper.createDiv('pm-gantt-left')
    leftPanel.style.width = `${this.labelWidth}px`
    leftPanel.style.minWidth = `${this.labelWidth}px`
    const leftHeader = leftPanel.createDiv('pm-gantt-left-header')
    leftHeader.style.height = `${HEADER_HEIGHT}px`
    leftHeader.createEl('span', { text: 'Task', cls: 'pm-gantt-left-header-label' })
    const leftBody = leftPanel.createDiv('pm-gantt-left-body')

    // Resize handle
    const resizeHandle = wrapper.createDiv('pm-gantt-resize-handle')
    let resizing = false
    let startX = 0
    let startWidth = 0
    resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault()
      resizing = true
      startX = e.clientX
      startWidth = this.labelWidth
      activeDocument.body.addClass('pm-resize-active')
    })
    const onMouseMove = (e: MouseEvent) => {
      if (!resizing) return
      const newWidth = Math.max(150, Math.min(600, startWidth + (e.clientX - startX)))
      this.labelWidth = newWidth
      leftPanel.style.width = `${newWidth}px`
      leftPanel.style.minWidth = `${newWidth}px`
    }
    const onMouseUp = () => {
      if (!resizing) return
      resizing = false
      activeDocument.body.removeClass('pm-resize-active')
    }
    activeDocument.addEventListener('mousemove', onMouseMove)
    activeDocument.addEventListener('mouseup', onMouseUp)
    this.cleanupFns.push(() => {
      activeDocument.removeEventListener('mousemove', onMouseMove)
      activeDocument.removeEventListener('mouseup', onMouseUp)
    })

    // Right panel: timeline
    const rightPanel = wrapper.createDiv('pm-gantt-right')
    this.scrollEl = rightPanel
    const svgContainer = this.scrollEl.createDiv('pm-gantt-svg-container')
    svgContainer.style.width = `${this.cfg.totalWidth}px`

    const totalRows = this.flatTasks.filter((f) => f.visible || f.depth === 0).length
    const svgHeight = HEADER_HEIGHT + (totalRows + 1) * ROW_HEIGHT // +1 for add-task row

    this.svgEl = svgEl('svg', {
      width: this.cfg.totalWidth,
      height: svgHeight,
      class: 'pm-gantt-svg'
    })
    svgContainer.appendChild(this.svgEl)

    // Escape to cancel linking mode; Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z
    // or Ctrl/Cmd+Y to redo the last drag. Only fire when the gantt view's
    // leaf is the active workspace leaf, so we don't hijack undo/redo while
    // the user is editing an unrelated note.
    const isGanttActive = (): boolean => {
      const leafEl = this.container.closest('.workspace-leaf')
      return leafEl?.classList.contains('mod-active') ?? false
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isGanttActive()) return
      if (e.key === 'Escape' && this.link.active) {
        cancelLink(this.link)
      }
      if (this.drag.isDragging) return
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        void this.plugin.undoLastAction()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        void this.plugin.redoLastAction()
      }
    }
    activeDocument.addEventListener('keydown', onKeyDown)
    this.cleanupFns.push(() => activeDocument.removeEventListener('keydown', onKeyDown))

    const ctx = this.makeRendererContext()
    renderTimelineHeader(ctx)
    renderGridLines(ctx, totalRows)
    renderTodayLine(ctx, svgHeight)
    this.renderTaskRows(leftBody, ctx)
    renderDependencyArrows(ctx)
    renderMilestoneLabels(ctx)

    // Forward wheel events from left panel to the scroll container
    // (left panel has overflow:hidden, so wheel events are swallowed otherwise)
    const onLeftWheel = (e: WheelEvent) => {
      rightPanel.scrollTop += e.deltaY
      rightPanel.scrollLeft += e.deltaX
      e.preventDefault()
    }
    leftPanel.addEventListener('wheel', onLeftWheel, { passive: false })
    this.cleanupFns.push(() => leftPanel.removeEventListener('wheel', onLeftWheel))

    // Add task button
    const addRow = leftBody.createDiv('pm-gantt-label-row pm-gantt-add-row')
    addRow.style.height = `${ROW_HEIGHT}px`
    const addBtn = addRow.createEl('button', { text: '+ add task', cls: 'pm-gantt-add-task-btn' })
    addBtn.addEventListener('click', () => {
      openTaskModal(this.plugin, this.project, { onSave: () => this.onRefresh() })
    })

    // Spacer compensates for horizontal scrollbar in the right panel.
    // The scrollbar reduces the right panel's viewport height, letting it
    // scroll further than the left body. Without this, rows desync at the bottom.
    const leftSpacer = leftBody.createDiv()
    leftSpacer.addClass('pm-no-shrink')
    const syncSpacer = () => {
      const hScrollbarH = rightPanel.offsetHeight - rightPanel.clientHeight
      leftSpacer.style.height = `${hScrollbarH}px`
    }

    // Sync vertical scroll: right → left
    rightPanel.addEventListener('scroll', () => {
      syncSpacer()
      leftBody.scrollTop = rightPanel.scrollTop
    })

    requestAnimationFrame(() => {
      syncSpacer()
      if (this.pendingScroll) {
        this.scrollEl.scrollTop = this.pendingScroll.top
        this.scrollEl.scrollLeft = Math.max(0, dateToX(this.cfg, this.pendingScroll.anchorDate))
        this.pendingScroll = null
      } else {
        this.scrollToToday()
      }
    })
  }

  private renderTaskRows(leftBody: HTMLElement, ctx: RendererContext): void {
    const barsGroup = svgEl('g', { class: 'pm-gantt-bars' })
    this.svgEl.appendChild(barsGroup)

    const labelCtx = { plugin: this.plugin, project: this.project, onRefresh: this.onRefresh }
    let rowIndex = 0
    const renderFlatList = (tasks: Task[], depth: number) => {
      for (const task of tasks) {
        renderTaskLabel(leftBody, task, depth, rowIndex, labelCtx)
        renderTaskBar(barsGroup, task, rowIndex, depth, ctx)
        rowIndex++
        if (!task.collapsed && task.subtasks.length) {
          renderFlatList(task.subtasks, depth + 1)
        }
      }
    }
    renderFlatList(this.getVisibleTasks(), 0)
  }

  private makeRendererContext(): RendererContext {
    return {
      svgEl: this.svgEl,
      cfg: this.cfg,
      plugin: this.plugin,
      project: this.project,
      flatTasks: this.flatTasks,
      drag: this.drag,
      link: this.link,
      onRefresh: this.onRefresh,
      cleanupFns: this.cleanupFns
    }
  }

  private getVisibleTasks(): Task[] {
    const tasks = filterArchived(this.project.tasks)
    return this.plugin.settings.ganttHideDone ? filterDone(tasks, this.plugin.settings.statuses) : tasks
  }

  private scrollToToday(): void {
    if (!this.scrollEl) return
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const x = dateToX(this.cfg, today)
    const center = x - this.scrollEl.clientWidth / 2
    this.scrollEl.scrollLeft = Math.max(0, center)
  }

  private setAllCollapsed(collapsed: boolean): void {
    for (const { task } of flattenTasks(this.project.tasks)) {
      if (task.subtasks.length > 0) task.collapsed = collapsed
    }
    this.render()
  }
}

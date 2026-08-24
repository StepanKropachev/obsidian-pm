import { Notice } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project, Task } from '../../types'
import { safeAsync } from '../../utils'
import type { TimelineCfg } from './TimelineConfig'
import { xToDate, getSnapPoints, snapX } from './TimelineConfig'

export interface DragState {
  isDragging: boolean
  dragSide: 'left' | 'right' | 'move' | null
  dragTask: Task | null
  dragStartX: number
  dragBarEl: SVGRectElement | null
  dragInitialX: number
  dragInitialW: number
  dragMoved: boolean
}

export function makeDragState(): DragState {
  return {
    isDragging: false,
    dragSide: null,
    dragTask: null,
    dragStartX: 0,
    dragBarEl: null,
    dragInitialX: 0,
    dragInitialW: 0,
    dragMoved: false
  }
}

export interface BarDragOpts {
  /** What the user grabs: an edge handle, or the bar itself to move the whole span. */
  trigger: SVGRectElement
  rect: SVGRectElement
  barGroup: SVGGElement
  task: Task
  side: 'left' | 'right' | 'move'
  x: number
  width: number
  cfg: TimelineCfg
  drag: DragState
  plugin: PMPlugin
  project: Project
  onRefresh: () => Promise<void>
}

/**
 * Dragging a bar edge moves the date that edge stands for; dragging the bar moves both and
 * keeps its length. The bar follows the pointer on its own, and the dates are written once
 * on release, so a drag costs one save.
 */
export function attachBarDrag(opts: BarDragOpts): () => void {
  const { trigger, rect, barGroup, task, side, x, width, cfg, drag, plugin, project, onRefresh } = opts
  const moving = side === 'move'
  let activeCleanup: (() => void) | null = null

  trigger.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0) return
    // A handle sits on the bar, which is itself draggable.
    if (!moving) e.stopPropagation()
    e.preventDefault()
    drag.isDragging = true
    drag.dragMoved = false
    drag.dragSide = side
    drag.dragTask = task
    drag.dragStartX = e.clientX
    drag.dragBarEl = rect
    drag.dragInitialX = x
    drag.dragInitialW = width

    const snapPoints = getSnapPoints(cfg)
    const snap = (value: number) => snapX(value, snapPoints, cfg.dayWidth * 0.4)
    let movedX = x
    let movedW = width

    const restore = () => {
      if (moving) {
        barGroup.removeAttribute('transform')
        return
      }
      rect.setAttribute('x', String(drag.dragInitialX))
      rect.setAttribute('width', String(drag.dragInitialW))
      repositionBarChildren(barGroup, drag.dragInitialX, drag.dragInitialW)
    }

    const onMove = (ev: MouseEvent) => {
      if (!drag.isDragging || !drag.dragBarEl) return
      const dx = ev.clientX - drag.dragStartX
      if (Math.abs(dx) > 3) drag.dragMoved = true
      if (moving) {
        movedX = snap(Math.max(0, drag.dragInitialX + dx))
        barGroup.setAttribute('transform', `translate(${movedX - drag.dragInitialX}, 0)`)
        return
      }
      if (side === 'left') {
        movedX = snap(Math.max(0, drag.dragInitialX + dx))
        movedW = drag.dragInitialX + drag.dragInitialW - movedX
      } else {
        movedW = snap(movedX + drag.dragInitialW + dx) - movedX
      }
      movedW = Math.max(cfg.dayWidth, movedW)
      drag.dragBarEl.setAttribute('x', String(movedX))
      drag.dragBarEl.setAttribute('width', String(movedW))
      repositionBarChildren(barGroup, movedX, movedW)
    }

    const onUp = safeAsync(async () => {
      activeDocument.removeEventListener('mousemove', onMove)
      activeDocument.removeEventListener('mouseup', onUp)
      if (moving) rect.classList.remove('pm-gantt-bar-grabbing')
      activeCleanup = null
      if (!drag.isDragging || !drag.dragTask || !drag.dragBarEl) return
      drag.isDragging = false
      if (!drag.dragMoved) {
        restore()
        return
      }

      const taskId = drag.dragTask.id
      const oldStart = drag.dragTask.start
      const oldDue = drag.dragTask.due
      const start = xToDate(cfg, snap(movedX)).toString()
      const due = xToDate(cfg, snap(movedX + movedW))
        .subtract({ days: 1 })
        .toString()
      const patch: Partial<Task> = side === 'left' ? { start } : side === 'right' ? { due } : { start, due }

      try {
        await plugin.store.updateTask(project, taskId, patch)
      } catch (err) {
        restore()
        new Notice('Failed to save date change. Please try again.')
        console.error('GanttDragHandler: save failed', err)
        return
      }
      const redoPatch: Partial<Task> = { ...patch }
      plugin.pushUndo({
        undo: async () => {
          await plugin.store.updateTask(project, taskId, { start: oldStart, due: oldDue })
          if (plugin.store.configFor(project).autoSchedule) {
            new Notice('Dates reverted. Dependent task dates may need adjustment.')
          }
          await onRefresh()
        },
        redo: async () => {
          await plugin.store.updateTask(project, taskId, redoPatch)
          await plugin.store.scheduleAfterChange(project, taskId)
          await onRefresh()
        }
      })
      await plugin.store.scheduleAfterChange(project, taskId)
      await onRefresh()
    })

    if (moving) rect.classList.add('pm-gantt-bar-grabbing')
    activeDocument.addEventListener('mousemove', onMove)
    activeDocument.addEventListener('mouseup', onUp)
    activeCleanup = () => {
      activeDocument.removeEventListener('mousemove', onMove)
      activeDocument.removeEventListener('mouseup', onUp)
    }
  })

  return () => {
    if (activeCleanup) {
      activeCleanup()
      activeCleanup = null
      drag.isDragging = false
      drag.dragBarEl = null
    }
  }
}

const HANDLE_W = 8

/** Keeps the label, handles, and progress overlay on the bar while it resizes. */
function repositionBarChildren(barGroup: SVGGElement, newX: number, newW: number): void {
  const label = barGroup.querySelector('.pm-gantt-bar-label')
  if (label) {
    label.setAttribute('x', String(newX + 8))
    if (newW <= 55) {
      label.setAttribute('visibility', 'hidden')
    } else {
      label.removeAttribute('visibility')
    }
  }

  const handles = barGroup.querySelectorAll('.pm-gantt-drag-handle')
  if (handles.length === 2) {
    handles[0].setAttribute('x', String(newX))
    handles[1].setAttribute('x', String(newX + newW - HANDLE_W))
  }

  const progress = barGroup.querySelector('.pm-gantt-bar-progress')
  if (progress) {
    progress.setAttribute('x', String(newX))
  }

  const icon = barGroup.querySelector('.pm-gantt-bar-icon')
  if (icon) {
    icon.setAttribute('x', String(newX + newW + 4))
  }
}

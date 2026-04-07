import { Notice } from 'obsidian';
import type PMPlugin from '../../main';
import type { Project, Task } from '../../types';
import type { TimelineCfg } from './TimelineConfig';
import { xToDate, dateToIso, getSnapPoints, snapX } from './TimelineConfig';

export interface DragState {
  isDragging: boolean;
  dragSide: 'left' | 'right' | null;
  dragTask: Task | null;
  dragStartX: number;
  dragBarEl: SVGRectElement | null;
  dragInitialX: number;
  dragInitialW: number;
  dragMoved: boolean;
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
    dragMoved: false,
  };
}

export function attachDragHandle(
  handle: SVGRectElement,
  side: 'left' | 'right',
  task: Task,
  rect: SVGRectElement,
  x: number,
  width: number,
  cfg: TimelineCfg,
  drag: DragState,
  plugin: PMPlugin,
  project: Project,
  onRefresh: () => Promise<void>,
): () => void {
  let activeCleanup: (() => void) | null = null;

  handle.addEventListener('mousedown', (e: MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    drag.isDragging = true;
    drag.dragMoved = false;
    drag.dragSide = side;
    drag.dragTask = task;
    drag.dragStartX = e.clientX;
    drag.dragBarEl = rect;
    drag.dragInitialX = x;
    drag.dragInitialW = width;

    const snapPoints = getSnapPoints(cfg);
    const snapThreshold = cfg.dayWidth * 0.4;

    const onMove = (ev: MouseEvent) => {
      if (!drag.isDragging || !drag.dragBarEl) return;
      const dx = ev.clientX - drag.dragStartX;
      if (Math.abs(dx) > 3) drag.dragMoved = true;
      let newX = drag.dragInitialX;
      let newW = drag.dragInitialW;
      if (drag.dragSide === 'left') {
        newX = Math.max(0, drag.dragInitialX + dx);
        newX = snapX(newX, snapPoints, snapThreshold);
        newW = drag.dragInitialX + drag.dragInitialW - newX;
      } else {
        newW = drag.dragInitialW + dx;
        const rightEdge = snapX(newX + newW, snapPoints, snapThreshold);
        newW = rightEdge - newX;
      }
      newW = Math.max(cfg.dayWidth, newW);
      drag.dragBarEl.setAttribute('x', String(newX));
      drag.dragBarEl.setAttribute('width', String(newW));
    };

    const onUp = async () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      activeCleanup = null;
      if (!drag.isDragging || !drag.dragTask || !drag.dragBarEl) return;
      drag.isDragging = false;
      if (!drag.dragMoved) return;

      const finalX = parseFloat(drag.dragBarEl.getAttribute('x') ?? '0');
      const finalW = parseFloat(drag.dragBarEl.getAttribute('width') ?? '0');

      const patch: Partial<Task> = {};
      if (drag.dragSide === 'left') {
        patch.start = dateToIso(xToDate(cfg, finalX));
      } else {
        const endD = xToDate(cfg, finalX + finalW);
        endD.setDate(endD.getDate() - 1);
        patch.due = dateToIso(endD);
      }
      try {
        await plugin.store.updateTask(project, drag.dragTask.id, patch);
      } catch (err) {
        drag.dragBarEl.setAttribute('x', String(drag.dragInitialX));
        drag.dragBarEl.setAttribute('width', String(drag.dragInitialW));
        new Notice('Failed to save date change. Please try again.');
        console.error('GanttDragHandler: save failed', err);
        return;
      }
      await onRefresh();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    activeCleanup = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  });

  return () => {
    if (activeCleanup) {
      activeCleanup();
      activeCleanup = null;
    }
  };
}

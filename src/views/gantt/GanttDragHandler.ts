import type PMPlugin from '../../main';
import type { Project, Task } from '../../types';
import type { TimelineCfg } from './TimelineConfig';
import { xToDate, dateToIso } from './TimelineConfig';

export interface DragState {
  isDragging: boolean;
  dragSide: 'left' | 'right' | null;
  dragTask: Task | null;
  dragStartX: number;
  dragBarEl: SVGRectElement | null;
  dragSheenEl: SVGRectElement | null;
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
    dragSheenEl: null,
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
  sheen: SVGRectElement,
  x: number,
  width: number,
  cfg: TimelineCfg,
  drag: DragState,
  plugin: PMPlugin,
  project: Project,
  onRefresh: () => Promise<void>,
): void {
  handle.addEventListener('mousedown', (e: MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    drag.isDragging = true;
    drag.dragMoved = false;
    drag.dragSide = side;
    drag.dragTask = task;
    drag.dragStartX = e.clientX;
    drag.dragBarEl = rect;
    drag.dragSheenEl = sheen;
    drag.dragInitialX = x;
    drag.dragInitialW = width;

    const onMove = (ev: MouseEvent) => {
      if (!drag.isDragging || !drag.dragBarEl) return;
      const dx = ev.clientX - drag.dragStartX;
      if (Math.abs(dx) > 3) drag.dragMoved = true;
      let newX = drag.dragInitialX;
      let newW = drag.dragInitialW;
      if (drag.dragSide === 'left') {
        newX = Math.max(0, drag.dragInitialX + dx);
        newW = drag.dragInitialW - dx;
      } else {
        newW = drag.dragInitialW + dx;
      }
      newW = Math.max(cfg.dayWidth, newW);
      drag.dragBarEl.setAttribute('x', String(newX));
      drag.dragBarEl.setAttribute('width', String(newW));
      if (drag.dragSheenEl) {
        drag.dragSheenEl.setAttribute('x', String(newX));
        drag.dragSheenEl.setAttribute('width', String(newW));
      }
    };

    const onUp = async () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
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
      await plugin.store.updateTask(project, drag.dragTask.id, patch);
      await onRefresh();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

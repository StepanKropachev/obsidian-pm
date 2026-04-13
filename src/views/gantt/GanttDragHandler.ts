import { Notice } from 'obsidian';
import type PMPlugin from '../../main';
import type { Project, Task } from '../../types';
import { safeAsync } from '../../utils';
import type { TimelineCfg } from './TimelineConfig';
import { xToDate, dateToIso, getSnapPoints, snapX } from './TimelineConfig';

export interface DragState {
  isDragging: boolean;
  dragSide: 'left' | 'right' | 'move' | null;
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

    const onUp = safeAsync(async () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      activeCleanup = null;
      if (!drag.isDragging || !drag.dragTask || !drag.dragBarEl) return;
      drag.isDragging = false;
      if (!drag.dragMoved) return;

      const finalX = parseFloat(drag.dragBarEl.getAttribute('x') ?? '0');
      const finalW = parseFloat(drag.dragBarEl.getAttribute('width') ?? '0');

      const snappedX = snapX(finalX, snapPoints, snapThreshold);
      const snappedRight = snapX(finalX + finalW, snapPoints, snapThreshold);

      const patch: Partial<Task> = {};
      if (drag.dragSide === 'left') {
        patch.start = dateToIso(xToDate(cfg, snappedX));
      } else {
        const endD = xToDate(cfg, snappedRight);
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
      if (plugin.settings.autoSchedule) {
        await plugin.store.scheduleAfterChange(project, drag.dragTask.id);
      }
      await onRefresh();
    });

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
      drag.isDragging = false;
      drag.dragBarEl = null;
    }
  };
}

export function attachBarMove(
  rect: SVGRectElement,
  task: Task,
  x: number,
  width: number,
  cfg: TimelineCfg,
  drag: DragState,
  plugin: PMPlugin,
  project: Project,
  onRefresh: () => Promise<void>,
): () => void {
  let activeCleanup: (() => void) | null = null;

  rect.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag.isDragging = true;
    drag.dragMoved = false;
    drag.dragSide = 'move';
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
      let newX = Math.max(0, drag.dragInitialX + dx);
      newX = snapX(newX, snapPoints, snapThreshold);
      drag.dragBarEl.setAttribute('x', String(newX));
    };

    const onUp = safeAsync(async () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      rect.classList.remove('pm-gantt-bar-grabbing');
      activeCleanup = null;
      if (!drag.isDragging || !drag.dragTask || !drag.dragBarEl) return;
      drag.isDragging = false;
      if (!drag.dragMoved) return;

      const finalX = parseFloat(drag.dragBarEl.getAttribute('x') ?? '0');
      const snappedX = snapX(finalX, snapPoints, snapThreshold);
      const snappedRight = snapX(snappedX + drag.dragInitialW, snapPoints, snapThreshold);

      const newStart = xToDate(cfg, snappedX);
      const newEnd = xToDate(cfg, snappedRight);
      newEnd.setDate(newEnd.getDate() - 1);

      const patch: Partial<Task> = {
        start: dateToIso(newStart),
        due: dateToIso(newEnd),
      };
      try {
        await plugin.store.updateTask(project, drag.dragTask.id, patch);
      } catch (err) {
        drag.dragBarEl.setAttribute('x', String(drag.dragInitialX));
        new Notice('Failed to save date change. Please try again.');
        console.error('GanttDragHandler: move save failed', err);
        return;
      }
      if (plugin.settings.autoSchedule) {
        await plugin.store.scheduleAfterChange(project, drag.dragTask.id);
      }
      await onRefresh();
    });

    rect.classList.add('pm-gantt-bar-grabbing');
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
      drag.isDragging = false;
      drag.dragBarEl = null;
    }
  };
}

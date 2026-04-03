import type { Task } from '../../types';
import { flattenTasks } from '../../store/TaskTreeOps';
import { openTaskModal } from '../../ui/ModalFactory';
import { COLOR_ACCENT } from '../../constants';
import {
  DAY_MS, ROW_HEIGHT, HEADER_HEIGHT, BAR_PADDING, BAR_BORDER_RADIUS,
  dateToX,
} from './TimelineConfig';
import { attachDragHandle } from './GanttDragHandler';
import type { RendererContext } from './GanttRenderer';

// ─── Task bars ─────────────────────────────────────────────────────────────

export function renderTaskBar(g: SVGGElement, task: Task, row: number, _depth: number, ctx: RendererContext): void {
  const startDate = task.start ? new Date(task.start) : null;
  const endDate   = task.due   ? new Date(task.due)   : null;
  if (!startDate && !endDate) return;

  const statusConfig  = ctx.plugin.settings.statuses.find(s => s.id === task.status);
  const color = statusConfig?.color ?? COLOR_ACCENT;
  const rowY   = HEADER_HEIGHT + row * ROW_HEIGHT;
  const y      = rowY + BAR_PADDING;
  const height = ROW_HEIGHT - BAR_PADDING * 2;

  // Row hover background
  const hoverRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  hoverRect.setAttribute('x', '0'); hoverRect.setAttribute('y', String(rowY));
  hoverRect.setAttribute('width', String(ctx.cfg.totalWidth));
  hoverRect.setAttribute('height', String(ROW_HEIGHT));
  hoverRect.setAttribute('class', 'pm-gantt-row-hover');
  g.appendChild(hoverRect);

  // Milestone → render diamond
  if (task.type === 'milestone') {
    renderMilestoneDiamond(g, task, row, color, ctx);
    return;
  }

  // Normal task bar
  const effectiveStart = startDate ?? endDate!;
  const effectiveEnd   = endDate ? new Date(endDate.getTime() + DAY_MS) : new Date(effectiveStart.getTime() + DAY_MS);

  const x      = Math.max(0, dateToX(ctx.cfg, effectiveStart));
  const xEnd   = Math.min(ctx.cfg.totalWidth, dateToX(ctx.cfg, effectiveEnd));
  const width  = Math.max(8, xEnd - x);

  // Group for bar + handles
  const barGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  barGroup.setAttribute('class', 'pm-gantt-bar-group');
  g.appendChild(barGroup);

  // Main bar — flat fill, no gradient/shadow/sheen
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', String(x)); rect.setAttribute('y', String(y));
  rect.setAttribute('width', String(width)); rect.setAttribute('height', String(height));
  rect.setAttribute('rx', String(BAR_BORDER_RADIUS)); rect.setAttribute('ry', String(BAR_BORDER_RADIUS));
  rect.setAttribute('fill', color); rect.setAttribute('opacity', '0.75');
  rect.setAttribute('class', 'pm-gantt-bar');
  barGroup.appendChild(rect);

  // Progress overlay
  if (task.progress > 0 && task.progress < 100) {
    const pw = (task.progress / 100) * width;
    const progRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    progRect.setAttribute('x', String(x)); progRect.setAttribute('y', String(y));
    progRect.setAttribute('width', String(pw)); progRect.setAttribute('height', String(height));
    progRect.setAttribute('rx', String(BAR_BORDER_RADIUS)); progRect.setAttribute('ry', String(BAR_BORDER_RADIUS));
    progRect.setAttribute('fill', color); progRect.setAttribute('opacity', '0.35');
    progRect.setAttribute('class', 'pm-gantt-bar-progress');
    barGroup.appendChild(progRect);
  }

  // Subtask stripe
  if (task.subtasks.length > 0) {
    const stripe = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    stripe.setAttribute('x', String(x)); stripe.setAttribute('y', String(y + height - 3));
    stripe.setAttribute('width', String(width)); stripe.setAttribute('height', '3');
    stripe.setAttribute('rx', '1.5');
    stripe.setAttribute('fill', color); stripe.setAttribute('opacity', '0.5');
    barGroup.appendChild(stripe);
  }

  // Recurrence indicator
  if (task.recurrence) {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    icon.setAttribute('x', String(x + width + 4)); icon.setAttribute('y', String(y + height / 2 + 5));
    icon.setAttribute('class', 'pm-gantt-bar-icon'); icon.textContent = 'R';
    barGroup.appendChild(icon);
  }

  // Label inside bar
  if (width > 55) {
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String(x + 8)); label.setAttribute('y', String(y + height / 2 + 5));
    label.setAttribute('class', 'pm-gantt-bar-label');
    const maxChars = Math.max(4, Math.floor((width - 16) / 7.5));
    label.textContent = task.title.length > maxChars ? task.title.slice(0, maxChars - 1) + '\u2026' : task.title;
    barGroup.appendChild(label);
  }

  // Tooltip
  const ttEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  const assigneesStr = task.assignees.length ? `\nAssignees: ${task.assignees.join(', ')}` : '';
  ttEl.textContent = `${task.title}\n${statusConfig?.label ?? task.status} \u00b7 ${task.priority}\nStart: ${task.start || '\u2014'}  Due: ${task.due || '\u2014'}\nProgress: ${task.progress}%${assigneesStr}`;
  rect.appendChild(ttEl);

  // Drag handles
  const HANDLE_W = 8;
  for (const side of ['left', 'right'] as const) {
    const hx = side === 'left' ? x : x + width - HANDLE_W;
    const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    handle.setAttribute('x', String(hx)); handle.setAttribute('y', String(y));
    handle.setAttribute('width', String(HANDLE_W)); handle.setAttribute('height', String(height));
    handle.setAttribute('rx', '3'); handle.setAttribute('ry', '3');
    handle.setAttribute('class', 'pm-gantt-drag-handle');
    handle.setAttribute('cursor', 'ew-resize');
    const cleanup = attachDragHandle(handle, side, task, rect, x, width, ctx.cfg, ctx.drag, ctx.plugin, ctx.project, ctx.onRefresh);
    ctx.cleanupFns.push(cleanup);
    barGroup.appendChild(handle);
  }

  // Click to open modal (suppressed if drag occurred)
  rect.setAttribute('cursor', 'pointer');
  rect.addEventListener('click', async () => {
    if (ctx.drag.dragMoved) { ctx.drag.dragMoved = false; return; }
    openTaskModal(ctx.plugin, ctx.project, { task, onSave: async () => { await ctx.onRefresh(); } });
  });
}

// ─── Milestone diamond ────────────────────────────────────────────────────

function renderMilestoneDiamond(g: SVGGElement, task: Task, row: number, color: string, ctx: RendererContext): void {
  const date = task.due ? new Date(task.due) : task.start ? new Date(task.start) : null;
  if (!date) return;

  const cx = dateToX(ctx.cfg, date) + ctx.cfg.dayWidth / 2;
  const cy = HEADER_HEIGHT + row * ROW_HEIGHT + ROW_HEIGHT / 2;
  const size = 12;

  const pts = `${cx},${cy - size} ${cx + size},${cy} ${cx},${cy + size} ${cx - size},${cy}`;
  const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  diamond.setAttribute('points', pts);
  diamond.setAttribute('fill', color);
  diamond.setAttribute('opacity', '0.8');
  diamond.setAttribute('class', 'pm-gantt-milestone');
  diamond.setAttribute('cursor', 'pointer');
  g.appendChild(diamond);

  const tt = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  tt.textContent = `${task.title} (milestone)\nDate: ${task.due || task.start || '\u2014'}`;
  diamond.appendChild(tt);

  diamond.addEventListener('click', async () => {
    openTaskModal(ctx.plugin, ctx.project, { task, onSave: async () => { await ctx.onRefresh(); } });
  });
}

// ─── Milestone labels ─────────────────────────────────────────────────────

export function renderMilestoneLabels(ctx: RendererContext): void {
  const all = flattenTasks(ctx.project.tasks);
  const milestones = all.filter(f => f.task.type === 'milestone' && (f.task.due || f.task.start));
  if (!milestones.length) return;

  const labelsG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  labelsG.setAttribute('class', 'pm-gantt-milestone-labels');

  for (const { task } of milestones) {
    const date = task.due ? new Date(task.due) : new Date(task.start);
    const x = dateToX(ctx.cfg, date) + ctx.cfg.dayWidth / 2;
    const statusConfig = ctx.plugin.settings.statuses.find(s => s.id === task.status);
    const color = statusConfig?.color ?? COLOR_ACCENT;

    const totalH = HEADER_HEIGHT + ctx.flatTasks.filter(f => f.visible || f.depth === 0).length * ROW_HEIGHT;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(x)); line.setAttribute('y1', String(HEADER_HEIGHT));
    line.setAttribute('x2', String(x)); line.setAttribute('y2', String(totalH));
    line.setAttribute('stroke', color); line.setAttribute('stroke-width', '1');
    line.setAttribute('stroke-dasharray', '4 4'); line.setAttribute('opacity', '0.4');
    labelsG.appendChild(line);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String(x)); label.setAttribute('y', '14');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'pm-gantt-milestone-label');
    label.setAttribute('fill', color);
    label.textContent = task.title.length > 16 ? task.title.slice(0, 14) + '\u2026' : task.title;
    labelsG.appendChild(label);
  }

  ctx.svgEl.appendChild(labelsG);
}

// ─── Dependency arrows ─────────────────────────────────────────────────────

export function renderDependencyArrows(ctx: RendererContext): void {
  const allFlat = flattenTasks(ctx.project.tasks);
  const indexMap = new Map<string, number>();
  let visibleRow = 0;
  const countVisible = (tasks: Task[]) => {
    for (const t of tasks) {
      indexMap.set(t.id, visibleRow);
      visibleRow++;
      if (!t.collapsed) countVisible(t.subtasks);
    }
  };
  countVisible(ctx.project.tasks);

  const arrowGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  arrowGroup.setAttribute('class', 'pm-gantt-arrows');

  for (const { task } of allFlat) {
    if (!task.dependencies?.length) continue;
    const toRow = indexMap.get(task.id);
    if (toRow === undefined) continue;
    const toY = HEADER_HEIGHT + toRow * ROW_HEIGHT + ROW_HEIGHT / 2;
    const toX = task.start ? dateToX(ctx.cfg, new Date(task.start)) : -1;
    if (toX < 0) continue;

    for (const depId of task.dependencies) {
      const fromRow = indexMap.get(depId);
      if (fromRow === undefined) continue;
      const depTask = allFlat.find(f => f.task.id === depId)?.task;
      if (!depTask?.due) continue;
      const fromX = dateToX(ctx.cfg, new Date(new Date(depTask.due).getTime() + DAY_MS));
      const fromY = HEADER_HEIGHT + fromRow * ROW_HEIGHT + ROW_HEIGHT / 2;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const midX = (fromX + toX) / 2;
      path.setAttribute('d', `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`);
      path.setAttribute('class', 'pm-gantt-arrow');
      path.setAttribute('marker-end', 'url(#pm-arrowhead)');
      arrowGroup.appendChild(path);
    }
  }

  // Arrowhead marker
  const defs = getOrCreateDefs(ctx.svgEl);
  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  marker.setAttribute('id', 'pm-arrowhead');
  marker.setAttribute('markerWidth', '8'); marker.setAttribute('markerHeight', '8');
  marker.setAttribute('refX', '6'); marker.setAttribute('refY', '3');
  marker.setAttribute('orient', 'auto');
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrow.setAttribute('d', 'M0,0 L0,6 L8,3 z');
  arrow.setAttribute('class', 'pm-gantt-arrowhead');
  marker.appendChild(arrow);
  defs.appendChild(marker);

  ctx.svgEl.appendChild(arrowGroup);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getOrCreateDefs(svgEl: SVGSVGElement): SVGDefsElement {
  return svgEl.querySelector('defs') as SVGDefsElement ?? (() => {
    const d = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svgEl.insertBefore(d, svgEl.firstChild);
    return d;
  })();
}

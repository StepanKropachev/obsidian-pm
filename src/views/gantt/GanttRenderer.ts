import type PMPlugin from '../../main';
import type { Project } from '../../types';
import type { FlatTask } from '../../store/TaskTreeOps';
import type { TimelineCfg } from './TimelineConfig';
import {
  DAY_MS, ROW_HEIGHT, HEADER_HEIGHT,
  dateToX,
} from './TimelineConfig';
import type { DragState } from './GanttDragHandler';

export { renderTimelineHeader } from './GanttHeaderRenderer';
export { renderTaskBar, renderMilestoneLabels, renderDependencyArrows } from './GanttTaskBarRenderer';

export interface RendererContext {
  svgEl: SVGSVGElement;
  cfg: TimelineCfg;
  plugin: PMPlugin;
  project: Project;
  flatTasks: FlatTask[];
  drag: DragState;
  onRefresh: () => Promise<void>;
  cleanupFns: (() => void)[];
}

// ─── Grid lines ────────────────────────────────────────────────────────────

export function renderGridLines(ctx: RendererContext, totalRows: number): void {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'pm-gantt-grid');

  const totalHeight = HEADER_HEIGHT + totalRows * ROW_HEIGHT;
  const { startDate, totalDays, dayWidth, granularity } = ctx.cfg;

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startDate.getTime() + i * DAY_MS);
    const x = i * dayWidth;
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const isMonday  = d.getDay() === 1;
    const isFirst   = d.getDate() === 1;

    if (isWeekend && granularity === 'day') {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(x)); rect.setAttribute('y', String(HEADER_HEIGHT));
      rect.setAttribute('width', String(dayWidth));
      rect.setAttribute('height', String(totalHeight - HEADER_HEIGHT));
      rect.setAttribute('class', 'pm-gantt-weekend');
      g.appendChild(rect);
    }

    const shouldDrawLine =
      (granularity === 'day' && isMonday) ||
      (granularity === 'week' && isMonday) ||
      (granularity === 'month' && isFirst) ||
      (granularity === 'quarter' && isFirst && d.getMonth() % 3 === 0);

    if (shouldDrawLine) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(x)); line.setAttribute('y1', String(HEADER_HEIGHT));
      line.setAttribute('x2', String(x)); line.setAttribute('y2', String(totalHeight));
      line.setAttribute('class', 'pm-gantt-gridline-v');
      g.appendChild(line);
    }
  }

  for (let r = 0; r <= totalRows; r++) {
    const y = HEADER_HEIGHT + r * ROW_HEIGHT;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '0'); line.setAttribute('y1', String(y));
    line.setAttribute('x2', String(ctx.cfg.totalWidth)); line.setAttribute('y2', String(y));
    line.setAttribute('class', 'pm-gantt-gridline-h');
    g.appendChild(line);
  }

  ctx.svgEl.appendChild(g);
}

// ─── Today line ────────────────────────────────────────────────────────────

export function renderTodayLine(ctx: RendererContext, svgHeight: number): void {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const x = dateToX(ctx.cfg, today);
  if (x < 0 || x > ctx.cfg.totalWidth) return;

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'pm-gantt-today-group');

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', String(x)); line.setAttribute('y1', String(HEADER_HEIGHT - 8));
  line.setAttribute('x2', String(x)); line.setAttribute('y2', String(svgHeight));
  line.setAttribute('class', 'pm-gantt-today-line');
  g.appendChild(line);

  const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  diamond.setAttribute('points', `${x},${HEADER_HEIGHT - 16} ${x + 6},${HEADER_HEIGHT - 8} ${x},${HEADER_HEIGHT} ${x - 6},${HEADER_HEIGHT - 8}`);
  diamond.setAttribute('class', 'pm-gantt-today-diamond');
  g.appendChild(diamond);

  ctx.svgEl.appendChild(g);
}

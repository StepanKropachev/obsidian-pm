import type PMPlugin from '../../main';
import type { Project, Task, FlatTask } from '../../types';
import { flattenTasks } from '../../types';
import { openTaskModal } from '../../ui/ModalFactory';
import type { TimelineCfg } from './TimelineConfig';
import {
  DAY_MS, ROW_HEIGHT, HEADER_HEIGHT, BAR_PADDING, BAR_BORDER_RADIUS,
  dateToX, getWeekNumber, lighten, darken,
} from './TimelineConfig';
import type { DragState } from './GanttDragHandler';
import { attachDragHandle } from './GanttDragHandler';

export interface RendererContext {
  svgEl: SVGSVGElement;
  cfg: TimelineCfg;
  plugin: PMPlugin;
  project: Project;
  flatTasks: FlatTask[];
  drag: DragState;
  onRefresh: () => Promise<void>;
}

// ─── Timeline header ───────────────────────────────────────────────────────

export function renderTimelineHeader(ctx: RendererContext): void {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'pm-gantt-header');

  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', '0'); bg.setAttribute('y', '0');
  bg.setAttribute('width', String(ctx.cfg.totalWidth));
  bg.setAttribute('height', String(HEADER_HEIGHT));
  bg.setAttribute('class', 'pm-gantt-header-bg');
  g.appendChild(bg);

  const { granularity } = ctx.cfg;
  if (granularity === 'day') renderDayHeader(g, ctx);
  else if (granularity === 'week') renderWeekHeader(g, ctx);
  else if (granularity === 'month') renderMonthHeader(g, ctx);
  else renderQuarterHeader(g, ctx);

  ctx.svgEl.appendChild(g);
}

function renderDayHeader(g: SVGGElement, ctx: RendererContext): void {
  const { startDate, totalDays, dayWidth } = ctx.cfg;
  renderMonthBands(g, 0, 24, ctx);
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startDate.getTime() + i * DAY_MS);
    const x = i * dayWidth;
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    if (isWeekend) {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(x)); rect.setAttribute('y', '24');
      rect.setAttribute('width', String(dayWidth));
      rect.setAttribute('height', String(HEADER_HEIGHT - 24));
      rect.setAttribute('class', 'pm-gantt-weekend-header');
      g.appendChild(rect);
    }
    if (dayWidth >= 20) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(x + dayWidth / 2)); text.setAttribute('y', '42');
      text.setAttribute('class', 'pm-gantt-header-day');
      text.textContent = String(d.getDate());
      g.appendChild(text);
    }
  }
}

function renderWeekHeader(g: SVGGElement, ctx: RendererContext): void {
  const { startDate, totalDays, dayWidth } = ctx.cfg;
  renderMonthBands(g, 0, 24, ctx);
  let i = 0;
  while (i < totalDays) {
    const d = new Date(startDate.getTime() + i * DAY_MS);
    const weekNum = getWeekNumber(d);
    const x = i * dayWidth;
    const w = Math.min(7, totalDays - i) * dayWidth;
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(x + w / 2)); text.setAttribute('y', '44');
    text.setAttribute('class', 'pm-gantt-header-week');
    text.textContent = `W${weekNum}`;
    g.appendChild(text);
    const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    tick.setAttribute('x1', String(x)); tick.setAttribute('y1', '24');
    tick.setAttribute('x2', String(x)); tick.setAttribute('y2', String(HEADER_HEIGHT));
    tick.setAttribute('class', 'pm-gantt-header-tick');
    g.appendChild(tick);
    i += 7;
  }
}

function renderMonthHeader(g: SVGGElement, ctx: RendererContext): void {
  const { startDate } = ctx.cfg;
  renderYearBands(g, 0, 24, ctx);
  const date = new Date(startDate);
  while (date < ctx.cfg.endDate) {
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const x1 = Math.max(0, dateToX(ctx.cfg, monthStart));
    const x2 = Math.min(ctx.cfg.totalWidth, dateToX(ctx.cfg, new Date(monthEnd.getTime() + DAY_MS)));
    const w = x2 - x1;
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(x1 + w / 2)); text.setAttribute('y', '44');
    text.setAttribute('class', 'pm-gantt-header-month');
    text.textContent = monthStart.toLocaleDateString(undefined, { month: 'short' });
    g.appendChild(text);
    const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    tick.setAttribute('x1', String(x1)); tick.setAttribute('y1', '24');
    tick.setAttribute('x2', String(x1)); tick.setAttribute('y2', String(HEADER_HEIGHT));
    tick.setAttribute('class', 'pm-gantt-header-tick');
    g.appendChild(tick);
    date.setMonth(date.getMonth() + 1);
  }
}

function renderQuarterHeader(g: SVGGElement, ctx: RendererContext): void {
  const { startDate } = ctx.cfg;
  renderYearBands(g, 0, 24, ctx);
  const date = new Date(startDate.getFullYear(), Math.floor(startDate.getMonth() / 3) * 3, 1);
  while (date < ctx.cfg.endDate) {
    const q = Math.floor(date.getMonth() / 3) + 1;
    const qEnd = new Date(date.getFullYear(), date.getMonth() + 3, 0);
    const x1 = Math.max(0, dateToX(ctx.cfg, date));
    const x2 = Math.min(ctx.cfg.totalWidth, dateToX(ctx.cfg, new Date(qEnd.getTime() + DAY_MS)));
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(x1 + (x2 - x1) / 2)); text.setAttribute('y', '44');
    text.setAttribute('class', 'pm-gantt-header-quarter');
    text.textContent = `Q${q} ${date.getFullYear()}`;
    g.appendChild(text);
    date.setMonth(date.getMonth() + 3);
  }
}

function renderMonthBands(g: SVGGElement, y: number, h: number, ctx: RendererContext): void {
  const date = new Date(ctx.cfg.startDate);
  while (date < ctx.cfg.endDate) {
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    const monthEnd   = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const x1 = Math.max(0, dateToX(ctx.cfg, monthStart));
    const x2 = Math.min(ctx.cfg.totalWidth, dateToX(ctx.cfg, new Date(monthEnd.getTime() + DAY_MS)));
    const w = x2 - x1;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(x1)); rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(w)); rect.setAttribute('height', String(h));
    rect.setAttribute('class', date.getMonth() % 2 === 0 ? 'pm-gantt-band-even' : 'pm-gantt-band-odd');
    g.appendChild(rect);
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(x1 + 6)); text.setAttribute('y', String(y + h - 6));
    text.setAttribute('class', 'pm-gantt-header-month-top');
    text.textContent = monthStart.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    g.appendChild(text);
    date.setMonth(date.getMonth() + 1);
  }
}

function renderYearBands(g: SVGGElement, y: number, h: number, ctx: RendererContext): void {
  const date = new Date(ctx.cfg.startDate.getFullYear(), 0, 1);
  while (date < ctx.cfg.endDate) {
    const yearEnd = new Date(date.getFullYear() + 1, 0, 1);
    const x1 = Math.max(0, dateToX(ctx.cfg, date));
    const x2 = Math.min(ctx.cfg.totalWidth, dateToX(ctx.cfg, yearEnd));
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(x1)); rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(x2 - x1)); rect.setAttribute('height', String(h));
    rect.setAttribute('class', date.getFullYear() % 2 === 0 ? 'pm-gantt-band-even' : 'pm-gantt-band-odd');
    g.appendChild(rect);
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(x1 + 6)); text.setAttribute('y', String(y + h - 6));
    text.setAttribute('class', 'pm-gantt-header-year');
    text.textContent = String(date.getFullYear());
    g.appendChild(text);
    date.setFullYear(date.getFullYear() + 1);
  }
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

// ─── Task bars ─────────────────────────────────────────────────────────────

export function renderTaskBar(g: SVGGElement, task: Task, row: number, _depth: number, ctx: RendererContext): void {
  const startDate = task.start ? new Date(task.start) : null;
  const endDate   = task.due   ? new Date(task.due)   : null;
  if (!startDate && !endDate) return;

  const statusConfig  = ctx.plugin.settings.statuses.find(s => s.id === task.status);
  const color = statusConfig?.color ?? '#6366f1';
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

  // Defs: gradient + shadow
  const defs = getOrCreateDefs(ctx.svgEl);
  const gradId = `pm-grad-${task.id}`;
  const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
  grad.setAttribute('id', gradId);
  grad.setAttribute('x1', '0%'); grad.setAttribute('y1', '0%');
  grad.setAttribute('x2', '100%'); grad.setAttribute('y2', '100%');
  const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  stop1.setAttribute('offset', '0%'); stop1.setAttribute('stop-color', lighten(color, 0.25));
  const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  stop2.setAttribute('offset', '100%'); stop2.setAttribute('stop-color', darken(color, 0.15));
  grad.appendChild(stop1); grad.appendChild(stop2); defs.appendChild(grad);

  const filterId = `pm-shadow-${task.id}`;
  const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.setAttribute('id', filterId);
  filter.setAttribute('x', '-5%'); filter.setAttribute('y', '-20%');
  filter.setAttribute('width', '110%'); filter.setAttribute('height', '160%');
  const fds = document.createElementNS('http://www.w3.org/2000/svg', 'feDropShadow');
  fds.setAttribute('dx', '0'); fds.setAttribute('dy', '2');
  fds.setAttribute('stdDeviation', '5'); fds.setAttribute('flood-color', color);
  fds.setAttribute('flood-opacity', '0.55');
  filter.appendChild(fds); defs.appendChild(filter);

  // Group for bar + handles
  const barGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  barGroup.setAttribute('class', 'pm-gantt-bar-group');
  g.appendChild(barGroup);

  // Main bar
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', String(x)); rect.setAttribute('y', String(y));
  rect.setAttribute('width', String(width)); rect.setAttribute('height', String(height));
  rect.setAttribute('rx', String(BAR_BORDER_RADIUS)); rect.setAttribute('ry', String(BAR_BORDER_RADIUS));
  rect.setAttribute('fill', `url(#${gradId})`); rect.setAttribute('filter', `url(#${filterId})`);
  rect.setAttribute('class', 'pm-gantt-bar');
  barGroup.appendChild(rect);

  // Sheen overlay
  const sheen = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  sheen.setAttribute('x', String(x)); sheen.setAttribute('y', String(y));
  sheen.setAttribute('width', String(width)); sheen.setAttribute('height', String(height / 2));
  sheen.setAttribute('rx', String(BAR_BORDER_RADIUS)); sheen.setAttribute('ry', String(BAR_BORDER_RADIUS));
  sheen.setAttribute('fill', 'rgba(255,255,255,0.25)');
  sheen.setAttribute('class', 'pm-gantt-bar-sheen');
  barGroup.appendChild(sheen);

  // Progress overlay
  if (task.progress > 0 && task.progress < 100) {
    const pw = (task.progress / 100) * width;
    const progRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    progRect.setAttribute('x', String(x)); progRect.setAttribute('y', String(y));
    progRect.setAttribute('width', String(pw)); progRect.setAttribute('height', String(height));
    progRect.setAttribute('rx', String(BAR_BORDER_RADIUS)); progRect.setAttribute('ry', String(BAR_BORDER_RADIUS));
    progRect.setAttribute('fill', 'rgba(0,0,0,0.15)');
    barGroup.appendChild(progRect);
    const pl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    pl.setAttribute('x1', String(x + pw)); pl.setAttribute('y1', String(y + 2));
    pl.setAttribute('x2', String(x + pw)); pl.setAttribute('y2', String(y + height - 2));
    pl.setAttribute('stroke', 'rgba(255,255,255,0.6)'); pl.setAttribute('stroke-width', '1.5');
    barGroup.appendChild(pl);
  }

  // Subtask stripe
  if (task.subtasks.length > 0) {
    const stripe = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    stripe.setAttribute('x', String(x)); stripe.setAttribute('y', String(y + height - 4));
    stripe.setAttribute('width', String(width)); stripe.setAttribute('height', '4');
    stripe.setAttribute('rx', String(BAR_BORDER_RADIUS));
    stripe.setAttribute('fill', darken(color, 0.3));
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
    label.textContent = task.title.length > 20 ? task.title.slice(0, 18) + '…' : task.title;
    barGroup.appendChild(label);
  }

  // Tooltip
  const ttEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  const assigneesStr = task.assignees.length ? `\nAssignees: ${task.assignees.join(', ')}` : '';
  ttEl.textContent = `${task.title}\n${statusConfig?.label ?? task.status} · ${task.priority}\nStart: ${task.start || '—'}  Due: ${task.due || '—'}\nProgress: ${task.progress}%${assigneesStr}`;
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
    attachDragHandle(handle, side, task, rect, sheen, x, width, ctx.cfg, ctx.drag, ctx.plugin, ctx.project, ctx.onRefresh);
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

  const defs = getOrCreateDefs(ctx.svgEl);
  const filterId = `pm-mshadow-${task.id}`;
  const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.setAttribute('id', filterId);
  filter.setAttribute('x', '-50%'); filter.setAttribute('y', '-50%');
  filter.setAttribute('width', '200%'); filter.setAttribute('height', '200%');
  const fds = document.createElementNS('http://www.w3.org/2000/svg', 'feDropShadow');
  fds.setAttribute('dx', '0'); fds.setAttribute('dy', '1');
  fds.setAttribute('stdDeviation', '4'); fds.setAttribute('flood-color', color);
  fds.setAttribute('flood-opacity', '0.6');
  filter.appendChild(fds); defs.appendChild(filter);

  const pts = `${cx},${cy - size} ${cx + size},${cy} ${cx},${cy + size} ${cx - size},${cy}`;
  const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  diamond.setAttribute('points', pts);
  diamond.setAttribute('fill', color);
  diamond.setAttribute('filter', `url(#${filterId})`);
  diamond.setAttribute('class', 'pm-gantt-milestone');
  diamond.setAttribute('cursor', 'pointer');
  g.appendChild(diamond);

  const innerPts = `${cx},${cy - size + 3} ${cx + size - 3},${cy} ${cx},${cy + size - 3} ${cx - size + 3},${cy}`;
  const inner = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  inner.setAttribute('points', innerPts);
  inner.setAttribute('fill', 'rgba(255,255,255,0.2)');
  inner.setAttribute('class', 'pm-gantt-milestone-sheen');
  g.appendChild(inner);

  const tt = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  tt.textContent = `${task.title} (milestone)\nDate: ${task.due || task.start || '—'}`;
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
    const color = statusConfig?.color ?? '#6366f1';

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
    label.textContent = task.title.length > 16 ? task.title.slice(0, 14) + '…' : task.title;
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

import type { RendererContext } from './GanttRenderer';
import {
  DAY_MS, HEADER_HEIGHT,
  dateToX, getWeekNumber,
} from './TimelineConfig';

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

  // Align to actual Mondays so header ticks match grid lines
  const dow = startDate.getDay(); // 0=Sun … 6=Sat
  const offsetToMonday = dow === 1 ? 0 : dow === 0 ? 1 : 8 - dow;

  // Partial first week (before the first Monday)
  if (offsetToMonday > 0) {
    const weekNum = getWeekNumber(startDate);
    const w = offsetToMonday * dayWidth;
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(w / 2)); text.setAttribute('y', '44');
    text.setAttribute('class', 'pm-gantt-header-week');
    text.textContent = `W${weekNum}`;
    g.appendChild(text);
  }

  // Full weeks from each Monday
  let i = offsetToMonday;
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

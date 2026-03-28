import type { Task, GanttGranularity } from '../../types';
import { flattenTasks } from '../../types';

export const DAY_MS = 86400_000;
export const ROW_HEIGHT = 44;
export const HEADER_HEIGHT = 56;
export const LABEL_WIDTH = 280;
export const BAR_PADDING = 8;
export const BAR_BORDER_RADIUS = 7;

export const DAY_WIDTH: Record<GanttGranularity, number> = {
  day: 44,
  week: 22,
  month: 9,
  quarter: 5,
};

export interface TimelineCfg {
  startDate: Date;
  endDate: Date;
  dayWidth: number;
  granularity: GanttGranularity;
  totalDays: number;
  totalWidth: number;
}

export function buildTimelineConfig(tasks: Task[], granularity: GanttGranularity): TimelineCfg {
  const allTasks = flattenTasks(tasks).map(f => f.task);
  const dates: Date[] = [];

  for (const t of allTasks) {
    if (t.start) dates.push(new Date(t.start));
    if (t.due)   dates.push(new Date(t.due));
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  dates.push(today);

  let startDate = dates.length
    ? new Date(Math.min(...dates.map(d => d.getTime())))
    : today;
  let endDate = dates.length
    ? new Date(Math.max(...dates.map(d => d.getTime())))
    : new Date(today.getTime() + 30 * DAY_MS);

  // Add padding
  startDate = new Date(startDate.getTime() - 7 * DAY_MS);
  endDate   = new Date(endDate.getTime() + 14 * DAY_MS);

  // Snap to month start for cleaner headers
  if (granularity === 'week' || granularity === 'month' || granularity === 'quarter') {
    startDate.setDate(1);
  }

  const dayWidth = DAY_WIDTH[granularity];
  const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / DAY_MS);
  return {
    startDate,
    endDate,
    dayWidth,
    granularity,
    totalDays,
    totalWidth: totalDays * dayWidth,
  };
}

export function dateToX(cfg: TimelineCfg, date: Date): number {
  const diff = (date.getTime() - cfg.startDate.getTime()) / DAY_MS;
  return diff * cfg.dayWidth;
}

export function xToDate(cfg: TimelineCfg, x: number): Date {
  const days = x / cfg.dayWidth;
  const ms = cfg.startDate.getTime() + days * DAY_MS;
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function dateToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function getWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function lighten(hex: string, amount: number): string {
  return adjustColor(hex, amount);
}

export function darken(hex: string, amount: number): string {
  return adjustColor(hex, -amount);
}

function adjustColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, Math.round(((num >> 16) & 0xff) + 255 * amount)));
  const g = Math.min(255, Math.max(0, Math.round(((num >> 8) & 0xff) + 255 * amount)));
  const b = Math.min(255, Math.max(0, Math.round((num & 0xff) + 255 * amount)));
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

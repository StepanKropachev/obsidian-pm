import type PMPlugin from '../main';
import { Project, Task, GanttGranularity, flattenTasks, FlatTask, makeTask, moveTaskInTree } from '../types';
import { TaskModal } from '../modals/TaskModal';
import type { SubView } from './SubView';

interface TimelineConfig {
  startDate: Date;
  endDate: Date;
  dayWidth: number;
  granularity: GanttGranularity;
  totalDays: number;
  totalWidth: number;
}

const DAY_MS = 86400_000;
const ROW_HEIGHT = 44;
const HEADER_HEIGHT = 56;
const LABEL_WIDTH = 280;
const BAR_PADDING = 8;      // vertical padding within row
const BAR_BORDER_RADIUS = 7;

// px per day for each granularity level
const DAY_WIDTH: Record<GanttGranularity, number> = {
  day: 44,
  week: 22,
  month: 9,
  quarter: 5,
};

export class GanttView implements SubView {
  private granularity: GanttGranularity;
  private scrollEl!: HTMLElement;
  private svgEl!: SVGSVGElement;
  private flatTasks: FlatTask[] = [];
  private cfg!: TimelineConfig;
  // Drag state
  private isDragging = false;
  private dragSide: 'left' | 'right' | null = null;
  private dragTask: Task | null = null;
  private dragStartX = 0;
  private dragBarEl: SVGRectElement | null = null;
  private dragSheenEl: SVGRectElement | null = null;
  private dragInitialX = 0;
  private dragInitialW = 0;
  private dragMoved = false;
  constructor(
    private container: HTMLElement,
    private project: Project,
    private plugin: PMPlugin,
    private onRefresh: () => Promise<void>,
  ) {
    this.granularity = plugin.settings.ganttGranularity;
  }

  render(): void {
    this.container.empty();
    this.container.addClass('pm-gantt-view');

    this.flatTasks = flattenTasks(this.project.tasks).filter(f => f.visible || f.depth === 0);
    this.cfg = this.buildTimelineConfig();

    this.renderGranularityControls();
    this.renderGantt();
  }

  // ─── Controls ──────────────────────────────────────────────────────────────

  private renderGranularityControls(): void {
    const bar = this.container.createDiv('pm-gantt-controls');

    const levels: GanttGranularity[] = ['day', 'week', 'month', 'quarter'];
    const labels: Record<GanttGranularity, string> = { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter' };

    for (const level of levels) {
      const btn = bar.createEl('button', {
        text: labels[level],
        cls: 'pm-gantt-zoom-btn',
      });
      if (level === this.granularity) btn.addClass('pm-gantt-zoom-btn--active');
      btn.addEventListener('click', async () => {
        this.granularity = level;
        this.plugin.settings.ganttGranularity = level;
        await this.plugin.saveSettings();
        this.render();
      });
    }

    // "Today" jump button
    const sep = bar.createEl('span', { cls: 'pm-gantt-sep' });
    const todayBtn = bar.createEl('button', { text: 'Today', cls: 'pm-btn pm-btn-ghost pm-gantt-today-btn' });
    todayBtn.addEventListener('click', () => this.scrollToToday());

    // "Expand all / Collapse all"
    const expBtn = bar.createEl('button', { text: 'Expand All', cls: 'pm-btn pm-btn-ghost' });
    expBtn.addEventListener('click', async () => {
      await this.setAllCollapsed(false);
    });
    const colBtn = bar.createEl('button', { text: 'Collapse All', cls: 'pm-btn pm-btn-ghost' });
    colBtn.addEventListener('click', async () => {
      await this.setAllCollapsed(true);
    });

  }

  // ─── Timeline config ───────────────────────────────────────────────────────

  private buildTimelineConfig(): TimelineConfig {
    const allTasks = flattenTasks(this.project.tasks).map(f => f.task);
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

    // Snap to week/month start/end for cleaner headers
    if (this.granularity === 'week' || this.granularity === 'month' || this.granularity === 'quarter') {
      startDate.setDate(1);
    }

    const dayWidth = DAY_WIDTH[this.granularity];
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / DAY_MS);
    return {
      startDate,
      endDate,
      dayWidth,
      granularity: this.granularity,
      totalDays,
      totalWidth: totalDays * dayWidth,
    };
  }

  // ─── Main render ───────────────────────────────────────────────────────────

  private renderGantt(): void {
    const wrapper = this.container.createDiv('pm-gantt-wrapper');

    // ── Left panel: task labels ────────────────────────────────────────────
    const leftPanel = wrapper.createDiv('pm-gantt-left');
    leftPanel.style.width = `${LABEL_WIDTH}px`;
    leftPanel.style.minWidth = `${LABEL_WIDTH}px`;

    const leftHeader = leftPanel.createDiv('pm-gantt-left-header');
    leftHeader.style.height = `${HEADER_HEIGHT}px`;
    leftHeader.createEl('span', { text: 'Task', cls: 'pm-gantt-left-header-label' });

    const leftBody = leftPanel.createDiv('pm-gantt-left-body');

    // ── Right panel: timeline ──────────────────────────────────────────────
    const rightPanel = wrapper.createDiv('pm-gantt-right');
    this.scrollEl = rightPanel.createDiv('pm-gantt-scroll');

    const svgContainer = this.scrollEl.createDiv('pm-gantt-svg-container');
    svgContainer.style.width = `${this.cfg.totalWidth}px`;

    const totalRows = this.flatTasks.filter(f => f.visible || f.depth === 0).length;
    const svgHeight = HEADER_HEIGHT + totalRows * ROW_HEIGHT;

    // Create SVG
    this.svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    this.svgEl.setAttribute('width', String(this.cfg.totalWidth));
    this.svgEl.setAttribute('height', String(svgHeight));
    this.svgEl.setAttribute('class', 'pm-gantt-svg');
    svgContainer.appendChild(this.svgEl);

    this.renderTimelineHeader();
    this.renderGridLines(totalRows);
    this.renderTodayLine(svgHeight);
    this.renderTaskRows(leftBody, totalRows);
    this.renderDependencyArrows();
    this.renderMilestoneLabels();
    // Sync vertical scroll between left and right
    rightPanel.addEventListener('scroll', () => {
      leftBody.scrollTop = rightPanel.scrollTop;
    });

    // Add bottom "+" button for top-level task
    const addRow = leftBody.createDiv('pm-gantt-label-row pm-gantt-add-row');
    addRow.style.height = `${ROW_HEIGHT}px`;
    const addBtn = addRow.createEl('button', { text: '+ Add Task', cls: 'pm-gantt-add-task-btn' });
    addBtn.addEventListener('click', async () => {
      new TaskModal(this.plugin.app, this.plugin, this.project, null, null, async () => {
        await this.onRefresh();
      }).open();
    });

    // Scroll to today on initial render
    requestAnimationFrame(() => this.scrollToToday());
  }

  // ─── Timeline header ───────────────────────────────────────────────────────

  private renderTimelineHeader(): void {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'pm-gantt-header');

    // Background rect
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', '0');
    bg.setAttribute('y', '0');
    bg.setAttribute('width', String(this.cfg.totalWidth));
    bg.setAttribute('height', String(HEADER_HEIGHT));
    bg.setAttribute('class', 'pm-gantt-header-bg');
    g.appendChild(bg);

    const { startDate, granularity, dayWidth } = this.cfg;

    if (granularity === 'day') {
      this.renderDayHeader(g);
    } else if (granularity === 'week') {
      this.renderWeekHeader(g);
    } else if (granularity === 'month') {
      this.renderMonthHeader(g);
    } else {
      this.renderQuarterHeader(g);
    }

    this.svgEl.appendChild(g);
  }

  private renderDayHeader(g: SVGGElement): void {
    const { startDate, totalDays, dayWidth } = this.cfg;
    // Top row: months
    this.renderMonthBands(g, 0, 24);
    // Bottom row: days
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate.getTime() + i * DAY_MS);
      const x = i * dayWidth;
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      if (isWeekend) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(x));
        rect.setAttribute('y', '24');
        rect.setAttribute('width', String(dayWidth));
        rect.setAttribute('height', String(HEADER_HEIGHT - 24));
        rect.setAttribute('class', 'pm-gantt-weekend-header');
        g.appendChild(rect);
      }
      if (dayWidth >= 20) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(x + dayWidth / 2));
        text.setAttribute('y', '42');
        text.setAttribute('class', 'pm-gantt-header-day');
        text.textContent = String(d.getDate());
        g.appendChild(text);
      }
    }
  }

  private renderWeekHeader(g: SVGGElement): void {
    const { startDate, totalDays, dayWidth } = this.cfg;
    this.renderMonthBands(g, 0, 24);
    // Week numbers
    let i = 0;
    while (i < totalDays) {
      const d = new Date(startDate.getTime() + i * DAY_MS);
      const weekNum = this.getWeekNumber(d);
      const x = i * dayWidth;
      const w = Math.min(7, totalDays - i) * dayWidth;
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(x + w / 2));
      text.setAttribute('y', '44');
      text.setAttribute('class', 'pm-gantt-header-week');
      text.textContent = `W${weekNum}`;
      g.appendChild(text);
      // tick
      const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      tick.setAttribute('x1', String(x));
      tick.setAttribute('y1', '24');
      tick.setAttribute('x2', String(x));
      tick.setAttribute('y2', String(HEADER_HEIGHT));
      tick.setAttribute('class', 'pm-gantt-header-tick');
      g.appendChild(tick);
      i += 7;
    }
  }

  private renderMonthHeader(g: SVGGElement): void {
    const { startDate, totalDays, dayWidth } = this.cfg;
    this.renderYearBands(g, 0, 24);
    // Month labels
    const date = new Date(startDate);
    while (date < this.cfg.endDate) {
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      const x1 = Math.max(0, this.dateToX(monthStart));
      const x2 = Math.min(this.cfg.totalWidth, this.dateToX(new Date(monthEnd.getTime() + DAY_MS)));
      const w = x2 - x1;
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(x1 + w / 2));
      text.setAttribute('y', '44');
      text.setAttribute('class', 'pm-gantt-header-month');
      text.textContent = monthStart.toLocaleDateString(undefined, { month: 'short' });
      g.appendChild(text);
      const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      tick.setAttribute('x1', String(x1));
      tick.setAttribute('y1', '24');
      tick.setAttribute('x2', String(x1));
      tick.setAttribute('y2', String(HEADER_HEIGHT));
      tick.setAttribute('class', 'pm-gantt-header-tick');
      g.appendChild(tick);
      date.setMonth(date.getMonth() + 1);
    }
  }

  private renderQuarterHeader(g: SVGGElement): void {
    const { startDate } = this.cfg;
    this.renderYearBands(g, 0, 24);
    const date = new Date(startDate.getFullYear(), Math.floor(startDate.getMonth() / 3) * 3, 1);
    while (date < this.cfg.endDate) {
      const q = Math.floor(date.getMonth() / 3) + 1;
      const qEnd = new Date(date.getFullYear(), date.getMonth() + 3, 0);
      const x1 = Math.max(0, this.dateToX(date));
      const x2 = Math.min(this.cfg.totalWidth, this.dateToX(new Date(qEnd.getTime() + DAY_MS)));
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(x1 + (x2 - x1) / 2));
      text.setAttribute('y', '44');
      text.setAttribute('class', 'pm-gantt-header-quarter');
      text.textContent = `Q${q} ${date.getFullYear()}`;
      g.appendChild(text);
      date.setMonth(date.getMonth() + 3);
    }
  }

  private renderMonthBands(g: SVGGElement, y: number, h: number): void {
    const date = new Date(this.cfg.startDate);
    while (date < this.cfg.endDate) {
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthEnd   = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      const x1 = Math.max(0, this.dateToX(monthStart));
      const x2 = Math.min(this.cfg.totalWidth, this.dateToX(new Date(monthEnd.getTime() + DAY_MS)));
      const w = x2 - x1;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(x1));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(w));
      rect.setAttribute('height', String(h));
      rect.setAttribute('class', date.getMonth() % 2 === 0 ? 'pm-gantt-band-even' : 'pm-gantt-band-odd');
      g.appendChild(rect);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(x1 + 6));
      text.setAttribute('y', String(y + h - 6));
      text.setAttribute('class', 'pm-gantt-header-month-top');
      text.textContent = monthStart.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
      g.appendChild(text);
      date.setMonth(date.getMonth() + 1);
    }
  }

  private renderYearBands(g: SVGGElement, y: number, h: number): void {
    const date = new Date(this.cfg.startDate.getFullYear(), 0, 1);
    while (date < this.cfg.endDate) {
      const yearEnd = new Date(date.getFullYear() + 1, 0, 1);
      const x1 = Math.max(0, this.dateToX(date));
      const x2 = Math.min(this.cfg.totalWidth, this.dateToX(yearEnd));
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(x1));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(x2 - x1));
      rect.setAttribute('height', String(h));
      rect.setAttribute('class', date.getFullYear() % 2 === 0 ? 'pm-gantt-band-even' : 'pm-gantt-band-odd');
      g.appendChild(rect);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(x1 + 6));
      text.setAttribute('y', String(y + h - 6));
      text.setAttribute('class', 'pm-gantt-header-year');
      text.textContent = String(date.getFullYear());
      g.appendChild(text);
      date.setFullYear(date.getFullYear() + 1);
    }
  }

  // ─── Grid lines ────────────────────────────────────────────────────────────

  private renderGridLines(totalRows: number): void {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'pm-gantt-grid');

    const totalHeight = HEADER_HEIGHT + totalRows * ROW_HEIGHT;
    const { startDate, totalDays, dayWidth, granularity } = this.cfg;

    // Vertical lines and weekend shading
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate.getTime() + i * DAY_MS);
      const x = i * dayWidth;
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const isMonday  = d.getDay() === 1;
      const isFirst   = d.getDate() === 1;

      if (isWeekend && granularity === 'day') {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(x));
        rect.setAttribute('y', String(HEADER_HEIGHT));
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
        line.setAttribute('x1', String(x));
        line.setAttribute('y1', String(HEADER_HEIGHT));
        line.setAttribute('x2', String(x));
        line.setAttribute('y2', String(totalHeight));
        line.setAttribute('class', 'pm-gantt-gridline-v');
        g.appendChild(line);
      }
    }

    // Horizontal lines per row
    for (let r = 0; r <= totalRows; r++) {
      const y = HEADER_HEIGHT + r * ROW_HEIGHT;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', '0');
      line.setAttribute('y1', String(y));
      line.setAttribute('x2', String(this.cfg.totalWidth));
      line.setAttribute('y2', String(y));
      line.setAttribute('class', 'pm-gantt-gridline-h');
      g.appendChild(line);
    }

    this.svgEl.appendChild(g);
  }

  // ─── Today line ────────────────────────────────────────────────────────────

  private renderTodayLine(svgHeight: number): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const x = this.dateToX(today);
    if (x < 0 || x > this.cfg.totalWidth) return;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'pm-gantt-today-group');

    // Glow line
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(x));
    line.setAttribute('y1', String(HEADER_HEIGHT - 8));
    line.setAttribute('x2', String(x));
    line.setAttribute('y2', String(svgHeight));
    line.setAttribute('class', 'pm-gantt-today-line');
    g.appendChild(line);

    // Diamond marker at top
    const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    diamond.setAttribute('points', `${x},${HEADER_HEIGHT - 16} ${x + 6},${HEADER_HEIGHT - 8} ${x},${HEADER_HEIGHT} ${x - 6},${HEADER_HEIGHT - 8}`);
    diamond.setAttribute('class', 'pm-gantt-today-diamond');
    g.appendChild(diamond);

    this.svgEl.appendChild(g);
  }

  // ─── Task rows ─────────────────────────────────────────────────────────────

  private renderTaskRows(leftBody: HTMLElement, totalRows: number): void {
    const barsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    barsGroup.setAttribute('class', 'pm-gantt-bars');
    this.svgEl.appendChild(barsGroup);

    let rowIndex = 0;
    const renderFlatList = (tasks: Task[], depth: number) => {
      for (const task of tasks) {
        if (!this.isVisible(task)) continue;
        this.renderTaskLabel(leftBody, task, depth, rowIndex);
        this.renderTaskBar(barsGroup, task, rowIndex, depth);
        rowIndex++;
        if (!task.collapsed && task.subtasks.length) {
          renderFlatList(task.subtasks, depth + 1);
        }
      }
    };
    renderFlatList(this.project.tasks, 0);
  }

  private isVisible(task: Task): boolean {
    // All top-level tasks are visible; subtasks handled by recursion check above
    return true;
  }

  private renderTaskLabel(container: HTMLElement, task: Task, depth: number, row: number): void {
    const el = container.createDiv('pm-gantt-label-row');
    el.style.height = `${ROW_HEIGHT}px`;
    el.style.paddingLeft = `${depth * 18 + 8}px`;
    el.dataset.taskId = task.id;

    // Make draggable for reordering
    el.draggable = true;
    el.addEventListener('dragstart', (e: DragEvent) => {
      e.dataTransfer?.setData('text/plain', task.id);
      el.addClass('pm-gantt-label-row--dragging');
    });
    el.addEventListener('dragend', () => {
      el.removeClass('pm-gantt-label-row--dragging');
    });
    el.addEventListener('dragover', (e: DragEvent) => {
      e.preventDefault();
      el.addClass('pm-gantt-label-row--drop-target');
    });
    el.addEventListener('dragleave', () => {
      el.removeClass('pm-gantt-label-row--drop-target');
    });
    el.addEventListener('drop', async (e: DragEvent) => {
      e.preventDefault();
      el.removeClass('pm-gantt-label-row--drop-target');
      const draggedId = e.dataTransfer?.getData('text/plain');
      if (!draggedId || draggedId === task.id) return;
      moveTaskInTree(this.project.tasks, draggedId, task.id, 'before');
      await this.plugin.store.saveProject(this.project);
      await this.onRefresh();
    });

    // Expand button
    if (task.subtasks.length > 0) {
      const btn = el.createEl('button', {
        text: task.collapsed ? '▶' : '▼',
        cls: 'pm-gantt-expand-btn',
      });
      btn.addEventListener('click', async () => {
        await this.plugin.store.updateTask(this.project, task.id, { collapsed: !task.collapsed });
        await this.onRefresh();
      });
    } else {
      el.createEl('span', { cls: 'pm-gantt-label-spacer' });
    }

    // Color dot
    const statusConfig = this.plugin.settings.statuses.find(s => s.id === task.status);
    const dot = el.createEl('span', { cls: 'pm-gantt-label-dot' });
    dot.style.background = statusConfig?.color ?? '#94a3b8';

    // Title
    const titleEl = el.createEl('span', { text: task.title, cls: 'pm-gantt-label-title' });
    titleEl.addEventListener('click', async () => {
      new TaskModal(this.plugin.app, this.plugin, this.project, task, null, async () => {
        await this.onRefresh();
      }).open();
    });

    // Progress %
    if (task.progress > 0) {
      el.createEl('span', { text: `${task.progress}%`, cls: 'pm-gantt-label-progress' });
    }

    // "+" button to add subtask (hover-visible)
    const addSubBtn = el.createEl('button', { text: '+', cls: 'pm-gantt-label-add-btn' });
    addSubBtn.title = 'Add subtask';
    addSubBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      new TaskModal(this.plugin.app, this.plugin, this.project, null, task.id, async () => {
        await this.onRefresh();
      }).open();
    });
  }

  private renderTaskBar(g: SVGGElement, task: Task, row: number, depth: number): void {
    const startDate = task.start ? new Date(task.start) : null;
    const endDate   = task.due   ? new Date(task.due)   : null;
    if (!startDate && !endDate) return;

    const statusConfig  = this.plugin.settings.statuses.find(s => s.id === task.status);
    const color = statusConfig?.color ?? '#6366f1';
    const rowY   = HEADER_HEIGHT + row * ROW_HEIGHT;
    const y      = rowY + BAR_PADDING;
    const height = ROW_HEIGHT - BAR_PADDING * 2;

    // Row hover background
    const hoverRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    hoverRect.setAttribute('x', '0');
    hoverRect.setAttribute('y', String(rowY));
    hoverRect.setAttribute('width', String(this.cfg.totalWidth));
    hoverRect.setAttribute('height', String(ROW_HEIGHT));
    hoverRect.setAttribute('class', 'pm-gantt-row-hover');
    g.appendChild(hoverRect);

    // ── Milestone → render diamond ────────────────────────────────────────────
    if (task.type === 'milestone') {
      this.renderMilestoneDiamond(g, task, row, color);
      return;
    }

    // ── Normal task bar ───────────────────────────────────────────────────────
    const effectiveStart = startDate ?? endDate!;
    const effectiveEnd   = endDate   ? new Date(endDate.getTime() + DAY_MS) : new Date(effectiveStart.getTime() + DAY_MS);

    const x      = Math.max(0, this.dateToX(effectiveStart));
    const xEnd   = Math.min(this.cfg.totalWidth, this.dateToX(effectiveEnd));
    const width  = Math.max(8, xEnd - x);

    // Defs: gradient + shadow
    const defs = this.getOrCreateDefs();
    const gradId = `pm-grad-${task.id}`;
    const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    grad.setAttribute('id', gradId);
    grad.setAttribute('x1', '0%'); grad.setAttribute('y1', '0%');
    grad.setAttribute('x2', '100%'); grad.setAttribute('y2', '100%');
    const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop1.setAttribute('offset', '0%'); stop1.setAttribute('stop-color', this.lighten(color, 0.25));
    const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop2.setAttribute('offset', '100%'); stop2.setAttribute('stop-color', this.darken(color, 0.15));
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
      stripe.setAttribute('fill', this.darken(color, 0.3));
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

    // ── Drag handles ──────────────────────────────────────────────────────────
    const HANDLE_W = 8;
    const makeHandle = (side: 'left' | 'right') => {
      const hx = side === 'left' ? x : x + width - HANDLE_W;
      const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      handle.setAttribute('x', String(hx)); handle.setAttribute('y', String(y));
      handle.setAttribute('width', String(HANDLE_W)); handle.setAttribute('height', String(height));
      handle.setAttribute('rx', '3'); handle.setAttribute('ry', '3');
      handle.setAttribute('class', 'pm-gantt-drag-handle');
      handle.setAttribute('cursor', 'ew-resize');
      handle.addEventListener('mousedown', (e: MouseEvent) => {
        e.stopPropagation(); e.preventDefault();
        this.isDragging = true;
        this.dragMoved = false;
        this.dragSide = side;
        this.dragTask = task;
        this.dragStartX = e.clientX;
        this.dragBarEl = rect;
        this.dragSheenEl = sheen;
        this.dragInitialX = x;
        this.dragInitialW = width;

        const onMove = (ev: MouseEvent) => {
          if (!this.isDragging || !this.dragBarEl) return;
          const dx = ev.clientX - this.dragStartX;
          if (Math.abs(dx) > 3) this.dragMoved = true;
          let newX = this.dragInitialX;
          let newW = this.dragInitialW;
          if (this.dragSide === 'left') {
            newX = Math.max(0, this.dragInitialX + dx);
            newW = this.dragInitialW - dx;
          } else {
            newW = this.dragInitialW + dx;
          }
          newW = Math.max(this.cfg.dayWidth, newW);
          this.dragBarEl.setAttribute('x', String(newX));
          this.dragBarEl.setAttribute('width', String(newW));
          if (this.dragSheenEl) {
            this.dragSheenEl.setAttribute('x', String(newX));
            this.dragSheenEl.setAttribute('width', String(newW));
          }
        };

        const onUp = async () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (!this.isDragging || !this.dragTask || !this.dragBarEl) return;
          this.isDragging = false;
          if (!this.dragMoved) return;

          const finalX = parseFloat(this.dragBarEl.getAttribute('x') ?? '0');
          const finalW = parseFloat(this.dragBarEl.getAttribute('width') ?? '0');

          const patch: Partial<Task> = {};
          if (this.dragSide === 'left') {
            patch.start = this.dateToIso(this.xToDate(finalX));
          } else {
            const endD = this.xToDate(finalX + finalW);
            // subtract 1 day because bar extends 1 day past due
            endD.setDate(endD.getDate() - 1);
            patch.due = this.dateToIso(endD);
          }
          await this.plugin.store.updateTask(this.project, this.dragTask.id, patch);
          await this.onRefresh();
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      barGroup.appendChild(handle);
    };
    makeHandle('left');
    makeHandle('right');

    // Click to open modal (suppressed if drag occurred)
    rect.setAttribute('cursor', 'pointer');
    rect.addEventListener('click', async () => {
      if (this.dragMoved) { this.dragMoved = false; return; }
      new TaskModal(this.plugin.app, this.plugin, this.project, task, null, async () => {
        await this.onRefresh();
      }).open();
    });
  }

  // ─── Milestone diamond ────────────────────────────────────────────────────

  private renderMilestoneDiamond(g: SVGGElement, task: Task, row: number, color: string): void {
    const date = task.due ? new Date(task.due) : task.start ? new Date(task.start) : null;
    if (!date) return;

    const cx = this.dateToX(date) + this.cfg.dayWidth / 2;
    const cy = HEADER_HEIGHT + row * ROW_HEIGHT + ROW_HEIGHT / 2;
    const size = 12;

    const defs = this.getOrCreateDefs();
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

    // Diamond
    const pts = `${cx},${cy - size} ${cx + size},${cy} ${cx},${cy + size} ${cx - size},${cy}`;
    const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    diamond.setAttribute('points', pts);
    diamond.setAttribute('fill', color);
    diamond.setAttribute('filter', `url(#${filterId})`);
    diamond.setAttribute('class', 'pm-gantt-milestone');
    diamond.setAttribute('cursor', 'pointer');
    g.appendChild(diamond);

    // Inner sheen
    const innerPts = `${cx},${cy - size + 3} ${cx + size - 3},${cy} ${cx},${cy + size - 3} ${cx - size + 3},${cy}`;
    const inner = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    inner.setAttribute('points', innerPts);
    inner.setAttribute('fill', 'rgba(255,255,255,0.2)');
    inner.setAttribute('class', 'pm-gantt-milestone-sheen');
    g.appendChild(inner);

    // Tooltip
    const tt = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    tt.textContent = `${task.title} (milestone)\nDate: ${task.due || task.start || '—'}`;
    diamond.appendChild(tt);

    // Click
    diamond.addEventListener('click', async () => {
      new TaskModal(this.plugin.app, this.plugin, this.project, task, null, async () => {
        await this.onRefresh();
      }).open();
    });
  }

  // ─── Milestone labels above timeline ──────────────────────────────────────

  private renderMilestoneLabels(): void {
    const all = flattenTasks(this.project.tasks);
    const milestones = all.filter(f => f.task.type === 'milestone' && (f.task.due || f.task.start));
    if (!milestones.length) return;

    const labelsG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    labelsG.setAttribute('class', 'pm-gantt-milestone-labels');

    for (const { task } of milestones) {
      const date = task.due ? new Date(task.due) : new Date(task.start);
      const x = this.dateToX(date) + this.cfg.dayWidth / 2;
      const statusConfig = this.plugin.settings.statuses.find(s => s.id === task.status);
      const color = statusConfig?.color ?? '#6366f1';

      // Dashed vertical line from header to bottom
      const totalH = HEADER_HEIGHT + this.flatTasks.filter(f => f.visible || f.depth === 0).length * ROW_HEIGHT;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(x)); line.setAttribute('y1', String(HEADER_HEIGHT));
      line.setAttribute('x2', String(x)); line.setAttribute('y2', String(totalH));
      line.setAttribute('stroke', color); line.setAttribute('stroke-width', '1');
      line.setAttribute('stroke-dasharray', '4 4'); line.setAttribute('opacity', '0.4');
      labelsG.appendChild(line);

      // Label at top
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', String(x)); label.setAttribute('y', '14');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'pm-gantt-milestone-label');
      label.setAttribute('fill', color);
      label.textContent = task.title.length > 16 ? task.title.slice(0, 14) + '…' : task.title;
      labelsG.appendChild(label);
    }

    this.svgEl.appendChild(labelsG);
  }

  private getOrCreateDefs(): SVGDefsElement {
    return this.svgEl.querySelector('defs') as SVGDefsElement ?? (() => {
      const d = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      this.svgEl.insertBefore(d, this.svgEl.firstChild);
      return d;
    })();
  }

  // ─── Dependency arrows ─────────────────────────────────────────────────────

  private renderDependencyArrows(): void {
    const allFlat = flattenTasks(this.project.tasks);
    const indexMap = new Map<string, number>();
    let visibleRow = 0;
    const countVisible = (tasks: Task[]) => {
      for (const t of tasks) {
        indexMap.set(t.id, visibleRow);
        visibleRow++;
        if (!t.collapsed) countVisible(t.subtasks);
      }
    };
    countVisible(this.project.tasks);

    const arrowGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    arrowGroup.setAttribute('class', 'pm-gantt-arrows');

    for (const { task } of allFlat) {
      if (!task.dependencies?.length) continue;
      const toRow = indexMap.get(task.id);
      if (toRow === undefined) continue;
      const toY = HEADER_HEIGHT + toRow * ROW_HEIGHT + ROW_HEIGHT / 2;
      const toX = task.start ? this.dateToX(new Date(task.start)) : -1;
      if (toX < 0) continue;

      for (const depId of task.dependencies) {
        const fromRow = indexMap.get(depId);
        if (fromRow === undefined) continue;
        const depTask = allFlat.find(f => f.task.id === depId)?.task;
        if (!depTask?.due) continue;
        const fromX = this.dateToX(new Date(new Date(depTask.due).getTime() + DAY_MS));
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
    const defs = this.svgEl.querySelector('defs') ?? (() => {
      const d = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      this.svgEl.insertBefore(d, this.svgEl.firstChild);
      return d;
    })();
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'pm-arrowhead');
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '8');
    marker.setAttribute('refX', '6');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arrow.setAttribute('d', 'M0,0 L0,6 L8,3 z');
    arrow.setAttribute('class', 'pm-gantt-arrowhead');
    marker.appendChild(arrow);
    defs.appendChild(marker);

    this.svgEl.appendChild(arrowGroup);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private dateToX(date: Date): number {
    const diff = (date.getTime() - this.cfg.startDate.getTime()) / DAY_MS;
    return diff * this.cfg.dayWidth;
  }

  /** Inverse of dateToX — convert pixel X to a Date (snapped to day) */
  private xToDate(x: number): Date {
    const days = x / this.cfg.dayWidth;
    const ms = this.cfg.startDate.getTime() + days * DAY_MS;
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private dateToIso(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private scrollToToday(): void {
    if (!this.scrollEl) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const x = this.dateToX(today);
    const center = x - this.scrollEl.clientWidth / 2;
    this.scrollEl.scrollLeft = Math.max(0, center);
  }

  private getWeekNumber(d: Date): number {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  }

  private async setAllCollapsed(collapsed: boolean): Promise<void> {
    const all = flattenTasks(this.project.tasks);
    for (const { task } of all) {
      if (task.subtasks.length > 0) {
        await this.plugin.store.updateTask(this.project, task.id, { collapsed });
      }
    }
    await this.onRefresh();
  }

  /** Lighten a hex color by a factor 0–1 */
  private lighten(hex: string, amount: number): string {
    return this.adjustColor(hex, amount);
  }

  /** Darken a hex color by a factor 0–1 */
  private darken(hex: string, amount: number): string {
    return this.adjustColor(hex, -amount);
  }

  private adjustColor(hex: string, amount: number): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, Math.max(0, Math.round(((num >> 16) & 0xff) + 255 * amount)));
    const g = Math.min(255, Math.max(0, Math.round(((num >> 8) & 0xff) + 255 * amount)));
    const b = Math.min(255, Math.max(0, Math.round((num & 0xff) + 255 * amount)));
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
  }
}

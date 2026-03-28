import type PMPlugin from '../../main';
import type { Project, Task, GanttGranularity, FlatTask } from '../../types';
import { flattenTasks } from '../../types';
import { openTaskModal } from '../../ui/ModalFactory';
import type { SubView } from '../SubView';
import type { TimelineCfg } from './TimelineConfig';
import { buildTimelineConfig, dateToX, HEADER_HEIGHT, ROW_HEIGHT, LABEL_WIDTH } from './TimelineConfig';
import { makeDragState } from './GanttDragHandler';
import type { DragState } from './GanttDragHandler';
import { renderTimelineHeader, renderGridLines, renderTodayLine, renderTaskBar, renderDependencyArrows, renderMilestoneLabels } from './GanttRenderer';
import type { RendererContext } from './GanttRenderer';
import { renderTaskLabel } from './TaskLabelRenderer';

export class GanttView implements SubView {
  private granularity: GanttGranularity;
  private scrollEl!: HTMLElement;
  private svgEl!: SVGSVGElement;
  private flatTasks: FlatTask[] = [];
  private cfg!: TimelineCfg;
  private drag: DragState = makeDragState();

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
    this.cfg = buildTimelineConfig(this.project.tasks, this.granularity);

    this.renderGranularityControls();
    this.renderGantt();
  }

  private renderGranularityControls(): void {
    const bar = this.container.createDiv('pm-gantt-controls');
    const levels: GanttGranularity[] = ['day', 'week', 'month', 'quarter'];
    const labels: Record<GanttGranularity, string> = { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter' };

    for (const level of levels) {
      const btn = bar.createEl('button', { text: labels[level], cls: 'pm-gantt-zoom-btn' });
      if (level === this.granularity) btn.addClass('pm-gantt-zoom-btn--active');
      btn.addEventListener('click', async () => {
        this.granularity = level;
        this.plugin.settings.ganttGranularity = level;
        await this.plugin.saveSettings();
        this.render();
      });
    }

    const sep = bar.createEl('span', { cls: 'pm-gantt-sep' });
    const todayBtn = bar.createEl('button', { text: 'Today', cls: 'pm-btn pm-btn-ghost pm-gantt-today-btn' });
    todayBtn.addEventListener('click', () => this.scrollToToday());

    const expBtn = bar.createEl('button', { text: 'Expand All', cls: 'pm-btn pm-btn-ghost' });
    expBtn.addEventListener('click', async () => { await this.setAllCollapsed(false); });
    const colBtn = bar.createEl('button', { text: 'Collapse All', cls: 'pm-btn pm-btn-ghost' });
    colBtn.addEventListener('click', async () => { await this.setAllCollapsed(true); });
  }

  private renderGantt(): void {
    const wrapper = this.container.createDiv('pm-gantt-wrapper');

    // Left panel: task labels
    const leftPanel = wrapper.createDiv('pm-gantt-left');
    leftPanel.style.width = `${LABEL_WIDTH}px`;
    leftPanel.style.minWidth = `${LABEL_WIDTH}px`;
    const leftHeader = leftPanel.createDiv('pm-gantt-left-header');
    leftHeader.style.height = `${HEADER_HEIGHT}px`;
    leftHeader.createEl('span', { text: 'Task', cls: 'pm-gantt-left-header-label' });
    const leftBody = leftPanel.createDiv('pm-gantt-left-body');

    // Right panel: timeline
    const rightPanel = wrapper.createDiv('pm-gantt-right');
    this.scrollEl = rightPanel.createDiv('pm-gantt-scroll');
    const svgContainer = this.scrollEl.createDiv('pm-gantt-svg-container');
    svgContainer.style.width = `${this.cfg.totalWidth}px`;

    const totalRows = this.flatTasks.filter(f => f.visible || f.depth === 0).length;
    const svgHeight = HEADER_HEIGHT + totalRows * ROW_HEIGHT;

    this.svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    this.svgEl.setAttribute('width', String(this.cfg.totalWidth));
    this.svgEl.setAttribute('height', String(svgHeight));
    this.svgEl.setAttribute('class', 'pm-gantt-svg');
    svgContainer.appendChild(this.svgEl);

    const ctx = this.makeRendererContext();
    renderTimelineHeader(ctx);
    renderGridLines(ctx, totalRows);
    renderTodayLine(ctx, svgHeight);
    this.renderTaskRows(leftBody, ctx);
    renderDependencyArrows(ctx);
    renderMilestoneLabels(ctx);

    // Sync vertical scroll
    rightPanel.addEventListener('scroll', () => {
      leftBody.scrollTop = rightPanel.scrollTop;
    });

    // Add task button
    const addRow = leftBody.createDiv('pm-gantt-label-row pm-gantt-add-row');
    addRow.style.height = `${ROW_HEIGHT}px`;
    const addBtn = addRow.createEl('button', { text: '+ Add Task', cls: 'pm-gantt-add-task-btn' });
    addBtn.addEventListener('click', async () => {
      openTaskModal(this.plugin, this.project, { onSave: async () => { await this.onRefresh(); } });
    });

    requestAnimationFrame(() => this.scrollToToday());
  }

  private renderTaskRows(leftBody: HTMLElement, ctx: RendererContext): void {
    const barsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    barsGroup.setAttribute('class', 'pm-gantt-bars');
    this.svgEl.appendChild(barsGroup);

    const labelCtx = { plugin: this.plugin, project: this.project, onRefresh: this.onRefresh };
    let rowIndex = 0;
    const renderFlatList = (tasks: Task[], depth: number) => {
      for (const task of tasks) {
        renderTaskLabel(leftBody, task, depth, rowIndex, labelCtx);
        renderTaskBar(barsGroup, task, rowIndex, depth, ctx);
        rowIndex++;
        if (!task.collapsed && task.subtasks.length) {
          renderFlatList(task.subtasks, depth + 1);
        }
      }
    };
    renderFlatList(this.project.tasks, 0);
  }

  private makeRendererContext(): RendererContext {
    return {
      svgEl: this.svgEl,
      cfg: this.cfg,
      plugin: this.plugin,
      project: this.project,
      flatTasks: this.flatTasks,
      drag: this.drag,
      onRefresh: this.onRefresh,
    };
  }

  private scrollToToday(): void {
    if (!this.scrollEl) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const x = dateToX(this.cfg, today);
    const center = x - this.scrollEl.clientWidth / 2;
    this.scrollEl.scrollLeft = Math.max(0, center);
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
}

import type PMPlugin from '../main';
import type { Project, Task, GanttGranularity } from '../types';
import { flattenTasks, filterArchived } from '../store/TaskTreeOps';
import { svgEl } from '../utils';
import type { SubView } from './SubView';
import {
  buildTimelineConfig, dateToX,
  HEADER_HEIGHT, ROW_HEIGHT, LABEL_WIDTH,
} from './gantt/TimelineConfig';
import type { TimelineCfg } from './gantt/TimelineConfig';
import { makeDragState } from './gantt/GanttDragHandler';
import type { DragState } from './gantt/GanttDragHandler';
import { makeLinkState, cancelLink } from './gantt/GanttLinkHandler';
import type { LinkState } from './gantt/GanttLinkHandler';
import {
  renderTimelineHeader,
  renderGridLines,
  renderTodayLine,
  renderTaskBar,
  renderMilestoneLabels,
} from './gantt/GanttRenderer';
import type { RendererContext } from './gantt/GanttRenderer';
import { renderTaskLabel } from './gantt/TaskLabelRenderer';
import type { LabelContext } from './gantt/TaskLabelRenderer';

export class GlobalGanttView implements SubView {
  private granularity: GanttGranularity;
  private scrollEl!: HTMLElement;
  private svgEl!: SVGSVGElement;
  private cfg!: TimelineCfg;
  private drag: DragState = makeDragState();
  private link: LinkState = makeLinkState();
  private labelWidth: number = LABEL_WIDTH;
  private cleanupFns: (() => void)[] = [];

  constructor(
    private container: HTMLElement,
    private projects: Project[],
    private plugin: PMPlugin,
    private onRefreshAll: () => Promise<void>,
  ) {
    this.granularity = plugin.settings.ganttGranularity;
  }

  destroy(): void {
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns = [];
  }

  render(): void {
    this.destroy();
    cancelLink(this.link);
    this.container.empty();
    this.container.addClass('pm-gantt-view');

    const allRootTasks: Task[] = [];
    for (const p of this.projects) {
      allRootTasks.push(...filterArchived(p.tasks));
    }
    this.cfg = buildTimelineConfig(allRootTasks, this.granularity);

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
      btn.addEventListener('click', () => {
        this.granularity = level;
        this.plugin.settings.ganttGranularity = level;
        void this.plugin.saveSettings();
        this.render();
      });
    }
    bar.createEl('span', { cls: 'pm-gantt-sep' });
    bar.createEl('button', { text: 'Today', cls: 'pm-btn pm-btn-ghost pm-gantt-today-btn' })
      .addEventListener('click', () => this.scrollToToday());
    bar.createEl('button', { text: 'Expand all', cls: 'pm-btn pm-btn-ghost' })
      .addEventListener('click', () => this.setAllCollapsed(false));
    bar.createEl('button', { text: 'Collapse all', cls: 'pm-btn pm-btn-ghost' })
      .addEventListener('click', () => this.setAllCollapsed(true));
  }

  private renderGantt(): void {
    // Pre-compute per-project task lists and row counts
    const projectSections: { project: Project; tasks: Task[]; rowCount: number }[] = [];
    let totalRows = 0;
    for (const p of this.projects) {
      const tasks = filterArchived(p.tasks);
      const rowCount = flattenTasks(tasks).filter(f => f.visible || f.depth === 0).length;
      projectSections.push({ project: p, tasks, rowCount });
      totalRows += 1 + rowCount; // 1 header row per project
    }

    const wrapper = this.container.createDiv('pm-gantt-wrapper');

    // Left panel
    const leftPanel = wrapper.createDiv('pm-gantt-left');
    leftPanel.style.width = `${this.labelWidth}px`;
    leftPanel.style.minWidth = `${this.labelWidth}px`;
    const leftHeader = leftPanel.createDiv('pm-gantt-left-header');
    leftHeader.style.height = `${HEADER_HEIGHT}px`;
    leftHeader.createEl('span', { text: 'Task', cls: 'pm-gantt-left-header-label' });
    const leftBody = leftPanel.createDiv('pm-gantt-left-body');

    // Resize handle
    const resizeHandle = wrapper.createDiv('pm-gantt-resize-handle');
    let resizing = false;
    let startX = 0;
    let startWidth = 0;
    resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault();
      resizing = true;
      startX = e.clientX;
      startWidth = this.labelWidth;
      document.body.addClass('pm-resize-active');
    });
    const onMouseMove = (e: MouseEvent) => {
      if (!resizing) return;
      this.labelWidth = Math.max(150, Math.min(600, startWidth + (e.clientX - startX)));
      leftPanel.style.width = `${this.labelWidth}px`;
      leftPanel.style.minWidth = `${this.labelWidth}px`;
    };
    const onMouseUp = () => {
      if (!resizing) return;
      resizing = false;
      document.body.removeClass('pm-resize-active');
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    this.cleanupFns.push(() => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    });

    // Right panel / SVG
    const rightPanel = wrapper.createDiv('pm-gantt-right');
    this.scrollEl = rightPanel;
    const svgContainer = this.scrollEl.createDiv('pm-gantt-svg-container');
    svgContainer.style.width = `${this.cfg.totalWidth}px`;

    const svgHeight = HEADER_HEIGHT + (totalRows + 1) * ROW_HEIGHT;
    this.svgEl = svgEl('svg', { width: this.cfg.totalWidth, height: svgHeight, class: 'pm-gantt-svg' });
    svgContainer.appendChild(this.svgEl);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelLink(this.link);
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        void this.plugin.undoLastAction();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    this.cleanupFns.push(() => document.removeEventListener('keydown', onKeyDown));

    // All flat tasks (for total height in milestone labels)
    const allFlatTasks = projectSections.flatMap(({ tasks }) =>
      flattenTasks(tasks).filter(f => f.visible || f.depth === 0),
    );

    // Shared context base (project overridden per section)
    const baseCtx: RendererContext = {
      svgEl: this.svgEl,
      cfg: this.cfg,
      plugin: this.plugin,
      project: this.projects[0] ?? ({} as Project),
      flatTasks: allFlatTasks,
      drag: this.drag,
      link: this.link,
      onRefresh: this.onRefreshAll,
      cleanupFns: this.cleanupFns,
    };

    renderTimelineHeader(baseCtx);
    renderGridLines(baseCtx, totalRows);
    renderTodayLine(baseCtx, svgHeight);

    const barsGroup = svgEl('g', { class: 'pm-gantt-bars' });
    this.svgEl.appendChild(barsGroup);

    let rowIndex = 0;

    for (const { project, tasks } of projectSections) {
      // Project section header in left panel
      const sectionHeader = leftBody.createDiv('pm-gantt-project-section-header');
      sectionHeader.style.height = `${ROW_HEIGHT}px`;
      const accent = sectionHeader.createDiv('pm-gantt-project-section-accent');
      accent.style.background = project.color;
      sectionHeader.createEl('span', { text: project.icon, cls: 'pm-gantt-project-section-icon' });
      sectionHeader.createEl('span', { text: project.title, cls: 'pm-gantt-project-section-title' });

      // SVG background stripe for project header row
      const projY = HEADER_HEIGHT + rowIndex * ROW_HEIGHT;
      barsGroup.appendChild(svgEl('rect', {
        x: 0, y: projY,
        width: this.cfg.totalWidth, height: ROW_HEIGHT,
        class: 'pm-gantt-project-section-bg',
      }));
      rowIndex++;

      // Per-project contexts for correct task operations
      const projectFlatTasks = flattenTasks(tasks).filter(f => f.visible || f.depth === 0);
      const projectCtx: RendererContext = {
        ...baseCtx,
        project,
        flatTasks: projectFlatTasks,
      };
      const labelCtx: LabelContext = { plugin: this.plugin, project, onRefresh: this.onRefreshAll };

      const renderFlatList = (taskList: Task[], depth: number) => {
        for (const task of taskList) {
          renderTaskLabel(leftBody, task, depth, rowIndex, labelCtx);
          renderTaskBar(barsGroup, task, rowIndex, depth, projectCtx);
          rowIndex++;
          if (!task.collapsed && task.subtasks.length) {
            renderFlatList(task.subtasks, depth + 1);
          }
        }
      };
      renderFlatList(tasks, 0);

      // Milestone labels for this project (dashed lines span full chart height)
      renderMilestoneLabels({ ...projectCtx, flatTasks: allFlatTasks });
    }

    // Sync vertical scroll between left and right panels
    const onLeftWheel = (e: WheelEvent) => {
      rightPanel.scrollTop += e.deltaY;
      rightPanel.scrollLeft += e.deltaX;
      e.preventDefault();
    };
    leftPanel.addEventListener('wheel', onLeftWheel, { passive: false });
    this.cleanupFns.push(() => leftPanel.removeEventListener('wheel', onLeftWheel));

    const leftSpacer = leftBody.createDiv();
    leftSpacer.addClass('pm-no-shrink');
    const syncSpacer = () => {
      const hScrollbarH = rightPanel.offsetHeight - rightPanel.clientHeight;
      leftSpacer.style.height = `${hScrollbarH}px`;
    };
    rightPanel.addEventListener('scroll', () => {
      syncSpacer();
      leftBody.scrollTop = rightPanel.scrollTop;
    });

    requestAnimationFrame(() => {
      syncSpacer();
      this.scrollToToday();
    });
  }

  private scrollToToday(): void {
    if (!this.scrollEl) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const x = dateToX(this.cfg, today);
    this.scrollEl.scrollLeft = Math.max(0, x - this.scrollEl.clientWidth / 2);
  }

  private setAllCollapsed(collapsed: boolean): void {
    for (const p of this.projects) {
      for (const { task } of flattenTasks(p.tasks)) {
        if (task.subtasks.length > 0) task.collapsed = collapsed;
      }
    }
    this.render();
  }
}

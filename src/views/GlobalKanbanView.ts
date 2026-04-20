import { TFile } from 'obsidian';
import type PMPlugin from '../main';
import type { Project, ProjectStatus } from '../types';
import { resolveProjectDates, computeProjectSpent, fmtNum, safeAsync } from '../utils';
import { openProjectModal } from '../ui/ModalFactory';
import type { SubView } from './SubView';

// ─── Column definitions ───────────────────────────────────────────────────────

interface StatusCol {
  id: ProjectStatus | '__none__';
  label: string;
  color: string;
}

const PROJECT_STATUS_COLS: StatusCol[] = [
  { id: '__none__',  label: 'No status',  color: '#8a94a0' },
  { id: 'draft',     label: 'Draft',      color: '#8a94a0' },
  { id: 'active',    label: 'Active',     color: '#79b58d' },
  { id: 'on-hold',   label: 'On hold',    color: '#b8a06b' },
  { id: 'completed', label: 'Completed',  color: '#6ba8a0' },
  { id: 'cancelled', label: 'Cancelled',  color: '#767491' },
];

// ─── View ─────────────────────────────────────────────────────────────────────

export class GlobalKanbanView implements SubView {
  private dragProject: Project | null = null;

  constructor(
    private container: HTMLElement,
    private projects: Project[],
    private plugin: PMPlugin,
    private onRefreshAll: () => Promise<void>,
  ) {}

  destroy(): void { /* no listeners to clean up */ }

  render(): void {
    this.container.empty();
    this.container.addClass('pm-kanban-view', 'pm-kanban-view--projects');

    const board = this.container.createDiv('pm-kanban-board');

    for (const col of PROJECT_STATUS_COLS) {
      const projects = this.getProjectsForCol(col.id);
      // hide empty "no status" column when all projects have a status
      if (col.id === '__none__' && projects.length === 0) continue;
      this.renderColumn(board, col, projects);
    }
  }

  private getProjectsForCol(colId: StatusCol['id']): Project[] {
    return this.projects.filter(p =>
      colId === '__none__' ? !p.status : p.status === colId,
    );
  }

  private renderColumn(board: HTMLElement, col: StatusCol, projects: Project[]): void {
    const colEl = board.createDiv('pm-kanban-col');
    colEl.dataset.status = col.id;

    // Column header
    const header = colEl.createDiv('pm-kanban-col-header');
    header.style.setProperty('--col-color', col.color);
    const topBar = header.createDiv('pm-kanban-col-topbar');
    topBar.setCssStyles({ background: col.color });
    const titleRow = header.createDiv('pm-kanban-col-title-row');
    const badge = titleRow.createEl('span', { text: col.label, cls: 'pm-kanban-col-badge' });
    badge.style.color = col.color;
    titleRow.createDiv('pm-kanban-col-header-right')
      .createEl('span', { text: String(projects.length), cls: 'pm-kanban-col-count' });

    // Cards container
    const cardsEl = colEl.createDiv('pm-kanban-cards');
    cardsEl.dataset.status = col.id;

    for (const project of projects) {
      this.renderProjectCard(cardsEl, project);
    }

    // Drop zone
    cardsEl.addEventListener('dragover', (e: DragEvent) => {
      e.preventDefault();
      cardsEl.addClass('pm-kanban-drop-target');
      // ghost reorder within column
      const afterEl = this.getDragAfterElement(cardsEl, e.clientY);
      const dragging = document.querySelector('.pm-kanban-card--dragging');
      if (dragging) {
        if (afterEl) cardsEl.insertBefore(dragging, afterEl);
        else cardsEl.appendChild(dragging);
      }
    });
    cardsEl.addEventListener('dragleave', () => cardsEl.removeClass('pm-kanban-drop-target'));
    cardsEl.addEventListener('drop', safeAsync(async (e: DragEvent) => {
      e.preventDefault();
      cardsEl.removeClass('pm-kanban-drop-target');
      if (!this.dragProject) return;
      const newStatus: ProjectStatus | undefined = col.id === '__none__' ? undefined : col.id;
      if (newStatus !== this.dragProject.status) {
        this.dragProject.status = newStatus;
        await this.plugin.store.saveProject(this.dragProject);
        await this.onRefreshAll();
      }
      this.dragProject = null;
    }));
  }

  private renderProjectCard(container: HTMLElement, project: Project): void {
    const card = container.createDiv('pm-kanban-card pm-kanban-project-card');
    card.draggable = true;
    card.dataset.projectId = project.id;

    // Accent bar
    const bar = card.createDiv('pm-kanban-card-proj-bar');
    bar.setCssStyles({ background: project.color });

    const body = card.createDiv('pm-kanban-card-body');

    // Icon + title
    const titleRow = body.createDiv('pm-kanban-card-title-row');
    titleRow.createEl('span', { text: project.icon, cls: 'pm-kanban-project-icon' });
    titleRow.createEl('span', {
      text: project.title,
      cls: 'pm-kanban-card-title pm-kanban-project-title',
      attr: { title: project.title },
    });

    // Portfolio / client
    const meta = project.client || project.portfolio;
    if (meta) {
      body.createEl('div', { text: meta, cls: 'pm-kanban-project-meta' });
    }

    // Owner
    if (project.owner) {
      const ownerRow = body.createDiv('pm-kanban-project-owner');
      const av = ownerRow.createEl('span', { cls: 'pm-avatar pm-avatar--sm' });
      av.textContent = project.owner.slice(0, 2).toUpperCase();
      ownerRow.createEl('span', { text: project.owner, cls: 'pm-kanban-project-owner-name' });
    }

    // Progress bar + task count
    const { total, done } = this.countTasks(project);
    if (total > 0) {
      const progRow = body.createDiv('pm-kanban-project-progress-row');
      progRow.createEl('span', { text: `${done}/${total}`, cls: 'pm-kanban-project-task-count' });
      const bar2 = progRow.createDiv('pm-kanban-project-pbar');
      const fill = bar2.createDiv('pm-kanban-project-pbar-fill');
      fill.setCssStyles({ width: `${Math.round((done / total) * 100)}%`, background: project.color });
    }

    // Budget
    if (project.budget) {
      const currency = project.currency ?? this.plugin.settings.defaultCurrency ?? 'EUR';
      const spent = computeProjectSpent(project);
      const budgetEl = body.createEl('div', { cls: 'pm-kanban-project-budget' });
      budgetEl.textContent = spent > 0
        ? `${currency} ${fmtNum(spent)} / ${fmtNum(project.budget)}`
        : `${currency} ${fmtNum(project.budget)}`;
      if (spent > project.budget) budgetEl.addClass('pm-kanban-project-budget--over');
    }

    // Date range
    const { start, end } = resolveProjectDates(project);
    if (start || end) {
      const datesEl = body.createDiv('pm-kanban-project-dates');
      const today = new Date().toISOString().slice(0, 10);
      if (start) datesEl.createEl('span', { text: fmtShortDate(start), cls: 'pm-kanban-project-date' });
      if (start && end) datesEl.createEl('span', { text: '→', cls: 'pm-kanban-project-date-sep' });
      if (end) {
        const endEl = datesEl.createEl('span', {
          text: fmtShortDate(end),
          cls: 'pm-kanban-project-date',
        });
        if (end < today && project.status !== 'completed' && project.status !== 'cancelled') {
          endEl.addClass('pm-kanban-project-date--overdue');
        }
      }
    }

    // Priority indicator
    if (project.priority) {
      const PRIORITY_COLORS: Record<string, string> = {
        critical: '#c47070', high: '#b8a06b', medium: '#8a94a0', low: '#79b58d',
      };
      const dot = card.createDiv('pm-kanban-project-priority-dot');
      dot.setCssStyles({ background: PRIORITY_COLORS[project.priority] ?? '#8a94a0' });
      dot.title = project.priority;
    }

    // Drag
    card.addEventListener('dragstart', (e: DragEvent) => {
      this.dragProject = project;
      card.addClass('pm-kanban-card--dragging');
      e.dataTransfer?.setData('text/plain', project.id);
    });
    card.addEventListener('dragend', () => {
      card.removeClass('pm-kanban-card--dragging');
      this.dragProject = null;
    });

    // Click → open project
    card.addEventListener('click', safeAsync(async () => {
      const file = this.plugin.app.vault.getAbstractFileByPath(project.filePath);
      if (file instanceof TFile) await this.plugin.openProjectFile(file);
    }));

    // Right-click → edit
    card.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      openProjectModal(this.plugin, {
        project,
        onSave: async () => { await this.onRefreshAll(); },
      });
    });
  }

  private countTasks(project: Project): { total: number; done: number } {
    let total = 0, done = 0;
    const walk = (tasks: typeof project.tasks) => {
      for (const t of tasks) {
        total++;
        if (this.plugin.settings.statuses.find(s => s.id === t.status)?.complete) done++;
        walk(t.subtasks);
      }
    };
    walk(project.tasks);
    return { total, done };
  }

  private getDragAfterElement(container: HTMLElement, y: number): Element | null {
    const cards = Array.from(container.querySelectorAll('.pm-kanban-card:not(.pm-kanban-card--dragging)'));
    let closest: Element | null = null;
    let closestOffset = Number.NEGATIVE_INFINITY;
    for (const card of cards) {
      const box = card.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closestOffset) { closestOffset = offset; closest = card; }
    }
    return closest;
  }
}

function fmtShortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

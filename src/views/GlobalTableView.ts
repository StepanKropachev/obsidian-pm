import { Menu, TFile } from 'obsidian';
import type PMPlugin from '../main';
import type { Project, Task, FilterState, TaskStatus, TaskPriority, DueDateFilter, ProjectTableColumn } from '../types';
import { makeDefaultFilter } from '../types';
import type { FlatTask } from '../store/TaskTreeOps';
import { flattenTasks, filterArchived, collectAllAssignees, collectAllTags, totalLoggedHours } from '../store/TaskTreeOps';
import { applyFilters } from './table/TableFilters';
import { renderFilterDropdown } from '../ui/FilterDropdown';
import { renderStatusBadge, renderPriorityBadge } from '../ui/StatusBadge';
import { openTaskModal } from '../ui/ModalFactory';
import { buildTaskContextMenu } from '../ui/TaskContextMenu';
import { openProjectModal } from '../ui/ModalFactory';
import {
  isTerminalStatus, formatDateShort, isTaskOverdue, stringToColor,
  formatBadgeText, safeAsync, resolveProjectDates, computeProjectSpent, fmtNum,
} from '../utils';
import { projectStatusColor } from '../modals/ProjectModal';
import type { SubView } from './SubView';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskSortKey = 'project' | 'title' | 'status' | 'priority' | 'due' | 'assignees' | 'progress';
type ProjSortKey = 'title' | 'status' | 'group' | 'client' | 'owner' | 'priority' | 'startDate' | 'endDate' | 'budget' | 'progress' | 'tasks';
type SortDir = 'asc' | 'desc';

interface GlobalFlatTask {
  task: Task;
  project: Project;
  depth: number;
  parentId: string | null;
  visible: boolean;
}

// ─── Column metadata ──────────────────────────────────────────────────────────

interface ColDef {
  key: ProjectTableColumn;
  label: string;
  width: string;
  sortKey: ProjSortKey;
}

const ALL_PROJECT_COLS: ColDef[] = [
  { key: 'status',    label: 'Status',      width: '110px', sortKey: 'status'    },
  { key: 'group',     label: 'Portfolio',   width: '120px', sortKey: 'group'     },
  { key: 'client',    label: 'Client',      width: '120px', sortKey: 'client'    },
  { key: 'owner',     label: 'Owner',       width: '120px', sortKey: 'owner'     },
  { key: 'priority',  label: 'Priority',    width: '100px', sortKey: 'priority'  },
  { key: 'startDate', label: 'Start',       width: '100px', sortKey: 'startDate' },
  { key: 'endDate',   label: 'End',         width: '100px', sortKey: 'endDate'   },
  { key: 'budget',    label: 'Budget',      width: '130px', sortKey: 'budget'    },
  { key: 'progress',  label: 'Progress',    width: '120px', sortKey: 'progress'  },
  { key: 'tasks',     label: 'Tasks',       width: '90px',  sortKey: 'tasks'     },
];

// ─── Priority helpers ─────────────────────────────────────────────────────────

function priorityOrder(p: string): number {
  return ({ critical: 0, high: 1, medium: 2, low: 3 } as Record<string, number>)[p] ?? 99;
}

// ─── View class ───────────────────────────────────────────────────────────────

export class GlobalTableView implements SubView {
  private filter: FilterState;
  private taskSortKey: TaskSortKey = 'project';
  private taskSortDir: SortDir = 'asc';
  private projSortKey: ProjSortKey = 'title';
  private projSortDir: SortDir = 'asc';
  private projectFilter: string[] = [];
  private taskProjectMap = new Map<string, Project>();
  private tableBody: HTMLElement | null = null;
  private projTableBody: HTMLElement | null = null;

  constructor(
    private container: HTMLElement,
    private projects: Project[],
    private plugin: PMPlugin,
    private onRefreshAll: () => Promise<void>,
  ) {
    this.filter = makeDefaultFilter();
  }

  render(): void {
    this.buildProjectMap();
    this.container.empty();
    this.container.addClass('pm-table-view');

    // Mode switcher: Tasks | Projects
    this.renderModeSwitcher();

    if (this.plugin.settings.globalTableMode === 'projects') {
      this.renderProjectsMode();
    } else {
      this.renderTasksMode();
    }
  }

  destroy(): void { /* no cleanup needed */ }

  // ─── Mode switcher ─────────────────────────────────────────────────────────

  private renderModeSwitcher(): void {
    const bar = this.container.createDiv('pm-table-mode-bar');
    const tabs: { mode: 'tasks' | 'projects'; label: string }[] = [
      { mode: 'projects', label: 'Projects' },
      { mode: 'tasks',    label: 'Tasks'    },
    ];
    for (const tab of tabs) {
      const btn = bar.createEl('button', {
        text: tab.label,
        cls: 'pm-table-mode-tab',
      });
      if (this.plugin.settings.globalTableMode === tab.mode) {
        btn.addClass('pm-table-mode-tab--active');
      }
      btn.addEventListener('click', () => {
        this.plugin.settings.globalTableMode = tab.mode;
        void this.plugin.saveSettings();
        this.render();
      });
    }
  }

  // ─── Projects mode ─────────────────────────────────────────────────────────

  private renderProjectsMode(): void {
    const wrapper = this.container.createDiv('pm-proj-table-toolbar');

    // Project text search
    const search = wrapper.createEl('input', {
      type: 'text',
      placeholder: 'Filter by title…',
      cls: 'pm-filter-input pm-proj-table-search',
    });
    let debounce: number | null = null;
    search.addEventListener('input', () => {
      if (debounce !== null) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => this.fillProjectsBody(), 120);
    });

    // Column picker
    const colBtn = wrapper.createEl('button', {
      text: 'Columns ▾',
      cls: 'pm-btn pm-btn-ghost pm-btn-sm pm-col-picker-btn',
    });
    colBtn.addEventListener('click', (e) => this.openColPicker(e));

    // Match count badge
    const countEl = wrapper.createEl('span', { cls: 'pm-proj-table-count' });

    // Table
    const tableWrap = this.container.createDiv('pm-table-wrapper');
    const table = tableWrap.createEl('table', { cls: 'pm-table pm-projects-table' });

    // Header
    const thead = table.createEl('thead');
    const hrow = thead.createEl('tr');
    this.renderProjectsHeader(hrow);

    // Body
    this.projTableBody = table.createEl('tbody');
    this.fillProjectsBody(search, countEl);
  }

  private renderProjectsHeader(hrow: HTMLElement): void {
    const visibleCols = this.getVisibleCols();

    // Title column (always first)
    const thTitle = hrow.createEl('th', { cls: 'pm-table-th-sortable pm-proj-th-title' });
    thTitle.createEl('span', { text: 'Project' });
    if (this.projSortKey === 'title') {
      thTitle.createEl('span', { text: this.projSortDir === 'asc' ? ' ↑' : ' ↓', cls: 'pm-sort-indicator' });
    }
    thTitle.addEventListener('click', () => this.toggleProjSort('title'));

    for (const col of visibleCols) {
      const th = hrow.createEl('th', {
        cls: `pm-table-th-sortable pm-proj-th-${col.key}`,
        attr: { 'data-col': col.key },
      });
      th.createEl('span', { text: col.label });
      if (this.projSortKey === col.sortKey) {
        th.createEl('span', { text: this.projSortDir === 'asc' ? ' ↑' : ' ↓', cls: 'pm-sort-indicator' });
      }
      const sk = col.sortKey;
      th.addEventListener('click', () => this.toggleProjSort(sk));
    }

    // Actions column
    hrow.createEl('th', { cls: 'pm-proj-th-actions' });
  }

  private fillProjectsBody(searchEl?: HTMLInputElement, countEl?: HTMLElement): void {
    if (!this.projTableBody) return;
    this.projTableBody.empty();

    const query = (searchEl?.value ?? '').toLowerCase();
    let rows = [...this.projects];
    if (query) {
      rows = rows.filter(p =>
        p.title.toLowerCase().includes(query) ||
        (p.client ?? '').toLowerCase().includes(query) ||
        (p.owner ?? '').toLowerCase().includes(query) ||
        (p.portfolio ?? '').toLowerCase().includes(query),
      );
    }

    // Sort
    rows.sort((a, b) => {
      const dir = this.projSortDir === 'asc' ? 1 : -1;
      switch (this.projSortKey) {
        case 'title':     return dir * a.title.localeCompare(b.title);
        case 'status':    return dir * (a.status ?? 'z').localeCompare(b.status ?? 'z');
        case 'group':     return dir * (a.portfolio ?? 'z').localeCompare(b.portfolio ?? 'z');
        case 'client':    return dir * (a.client ?? 'z').localeCompare(b.client ?? 'z');
        case 'owner':     return dir * (a.owner ?? 'z').localeCompare(b.owner ?? 'z');
        case 'priority':  return dir * (priorityOrder(a.priority ?? '') - priorityOrder(b.priority ?? ''));
        case 'startDate': { const { start: s1 } = resolveProjectDates(a); const { start: s2 } = resolveProjectDates(b); return dir * (s1 ?? 'z').localeCompare(s2 ?? 'z'); }
        case 'endDate':   { const { end: e1 } = resolveProjectDates(a); const { end: e2 } = resolveProjectDates(b); return dir * (e1 ?? 'z').localeCompare(e2 ?? 'z'); }
        case 'budget':    return dir * ((a.budget ?? 0) - (b.budget ?? 0));
        case 'progress':  { const pa = this.projectProgress(a); const pb = this.projectProgress(b); return dir * (pa - pb); }
        case 'tasks':     { const ta = this.countTasks(a); const tb = this.countTasks(b); return dir * (ta.total - tb.total); }
        default: return 0;
      }
    });

    if (countEl) {
      countEl.setText(rows.length === this.projects.length
        ? `${rows.length} projects`
        : `${rows.length} / ${this.projects.length} projects`);
    }

    for (const project of rows) {
      this.renderProjectRow(project);
    }

    if (rows.length === 0) {
      const tr = this.projTableBody.createEl('tr');
      const td = tr.createEl('td', { attr: { colspan: '20' } });
      td.addClass('pm-table-empty-cell');
      td.setText('No projects match the current filters.');
    }
  }

  private renderProjectRow(project: Project): void {
    const visibleCols = this.getVisibleCols();
    const { total, done } = this.countTasks(project);
    const { start, end } = resolveProjectDates(project);
    const today = new Date().toISOString().slice(0, 10);
    const isOverdue = end && end < today && project.status !== 'completed' && project.status !== 'cancelled';

    const row = this.projTableBody!.createEl('tr', { cls: 'pm-table-row pm-proj-table-row' });
    row.dataset.projectId = project.id;

    // ── Title cell ────────────────────────────────────────────────────────
    const titleCell = row.createEl('td', { cls: 'pm-proj-table-title-cell' });
    const titleInner = titleCell.createDiv('pm-proj-table-title-inner');
    const dot = titleInner.createEl('span', { cls: 'pm-proj-table-dot' });
    dot.style.background = project.color;
    titleInner.createEl('span', { text: project.icon, cls: 'pm-proj-table-icon' });
    const titleText = titleInner.createEl('span', {
      text: project.title,
      cls: 'pm-proj-table-name',
      attr: { title: project.title },
    });
    titleText.addEventListener('click', safeAsync(async () => {
      const file = this.plugin.app.vault.getAbstractFileByPath(project.filePath);
      if (file instanceof TFile) await this.plugin.openProjectFile(file);
    }));
    if (isOverdue) titleCell.addClass('pm-proj-table-title-cell--overdue');

    // ── Configurable columns ──────────────────────────────────────────────
    for (const col of visibleCols) {
      const td = row.createEl('td', { cls: `pm-proj-table-cell pm-proj-cell-${col.key}` });

      switch (col.key) {
        case 'status': {
          if (project.status) {
            const badge = td.createEl('span', {
              text: project.status.replace('-', ' '),
              cls: 'pm-project-status-badge',
            });
            badge.style.setProperty('--badge-color', projectStatusColor(project.status));
          }
          break;
        }
        case 'group':
          if (project.portfolio) {
            const pf = this.plugin.settings.portfolios.find(g => g.name === project.portfolio);
            const grpColor = pf?.color ?? this.plugin.settings.groupColors[project.portfolio] ?? '#8b72be';
            const dot2 = td.createEl('span', { cls: 'pm-proj-table-group-dot' });
            dot2.style.background = grpColor;
            td.createEl('span', { text: project.portfolio, cls: 'pm-proj-table-text' });
          }
          break;
        case 'client':
          if (project.client) td.createEl('span', { text: project.client, cls: 'pm-proj-table-text' });
          break;
        case 'owner':
          if (project.owner) {
            const av = td.createEl('span', { cls: 'pm-avatar pm-avatar--sm' });
            av.textContent = project.owner.slice(0, 2).toUpperCase();
            av.style.background = stringToColor(project.owner);
            td.createEl('span', { text: project.owner, cls: 'pm-proj-table-owner-name' });
          }
          break;
        case 'priority': {
          if (project.priority) {
            const PRIORITY_COLORS: Record<string, string> = {
              critical: '#c47070', high: '#b8a06b', medium: '#8a94a0', low: '#79b58d',
            };
            const pb = td.createEl('span', {
              text: project.priority,
              cls: 'pm-project-priority-badge',
            });
            pb.style.setProperty('--badge-color', PRIORITY_COLORS[project.priority] ?? '#8a94a0');
          }
          break;
        }
        case 'startDate':
          if (start) {
            td.createEl('span', { text: fmtTableDate(start), cls: 'pm-proj-table-date' });
          }
          break;
        case 'endDate':
          if (end) {
            const endEl = td.createEl('span', { text: fmtTableDate(end), cls: 'pm-proj-table-date' });
            if (isOverdue) endEl.addClass('pm-proj-table-date--overdue');
          }
          break;
        case 'budget': {
          if (project.budget) {
            const currency = project.currency ?? this.plugin.settings.defaultCurrency ?? 'EUR';
            const spent = computeProjectSpent(project);
            const budgetEl = td.createEl('div', { cls: 'pm-proj-table-budget' });
            if (spent > 0) {
              budgetEl.createEl('span', {
                text: `${currency} ${fmtNum(spent)} / ${fmtNum(project.budget)}`,
                cls: spent > project.budget ? 'pm-proj-table-budget--over' : '',
              });
            } else {
              budgetEl.createEl('span', { text: `${currency} ${fmtNum(project.budget)}` });
            }
          }
          break;
        }
        case 'progress': {
          if (total > 0) {
            const pct = Math.round((done / total) * 100);
            const pbar = td.createDiv('pm-progress-bar');
            const pfill = pbar.createDiv('pm-progress-bar-fill');
            pfill.style.width = `${pct}%`;
            pfill.style.background = project.color;
            td.createEl('span', { text: `${pct}%`, cls: 'pm-progress-text' });
          }
          break;
        }
        case 'tasks':
          if (total > 0) {
            td.createEl('span', {
              text: `${done}/${total}`,
              cls: 'pm-proj-table-tasks',
            });
          }
          break;
      }
    }

    // ── Actions ───────────────────────────────────────────────────────────
    const actCell = row.createEl('td', { cls: 'pm-table-cell-actions' });
    const actBtn = actCell.createEl('button', { cls: 'pm-icon-btn', attr: { 'aria-label': 'Project actions' } });
    actBtn.setText('⋮');
    actBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = new Menu();
      menu.addItem(item => item.setTitle('Edit project').setIcon('settings').onClick(() => {
        openProjectModal(this.plugin, {
          project,
          onSave: async () => { await this.onRefreshAll(); },
        });
      }));
      menu.addItem(item => item.setTitle('Open project').setIcon('file').onClick(safeAsync(async () => {
        const file = this.plugin.app.vault.getAbstractFileByPath(project.filePath);
        if (file instanceof TFile) await this.plugin.openProjectFile(file);
      })));
      menu.showAtMouseEvent(e);
    });

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const menu = new Menu();
      menu.addItem(item => item.setTitle('Edit project').setIcon('settings').onClick(() => {
        openProjectModal(this.plugin, {
          project,
          onSave: async () => { await this.onRefreshAll(); },
        });
      }));
      menu.showAtMouseEvent(e);
    });
  }

  private toggleProjSort(key: ProjSortKey): void {
    if (this.projSortKey === key) {
      this.projSortDir = this.projSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.projSortKey = key;
      this.projSortDir = 'asc';
    }
    this.render();
  }

  private getVisibleCols(): ColDef[] {
    const visible = this.plugin.settings.globalTableProjectColumns;
    return ALL_PROJECT_COLS.filter(c => visible.includes(c.key));
  }

  private openColPicker(e: MouseEvent): void {
    const menu = new Menu();
    menu.addItem(item => item.setTitle('Visible columns').setDisabled(true));
    menu.addSeparator();
    for (const col of ALL_PROJECT_COLS) {
      const isVisible = this.plugin.settings.globalTableProjectColumns.includes(col.key);
      menu.addItem(item => item
        .setTitle(col.label)
        .setChecked(isVisible)
        .onClick(() => {
          const cols = this.plugin.settings.globalTableProjectColumns;
          const idx = cols.indexOf(col.key);
          if (idx >= 0) cols.splice(idx, 1);
          else cols.push(col.key);
          void this.plugin.saveSettings();
          this.render();
        }));
    }
    menu.showAtMouseEvent(e);
  }

  private projectProgress(project: Project): number {
    const { total, done } = this.countTasks(project);
    return total > 0 ? done / total : 0;
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

  // ─── Tasks mode ────────────────────────────────────────────────────────────

  private renderTasksMode(): void {
    this.buildProjectMap();
    this.renderFilterBar();
    this.renderTaskTable();
  }

  private buildProjectMap(): void {
    this.taskProjectMap.clear();
    for (const p of this.projects) {
      for (const { task } of flattenTasks(p.tasks)) {
        this.taskProjectMap.set(task.id, p);
      }
    }
  }

  private getAllFlatTasks(): GlobalFlatTask[] {
    const result: GlobalFlatTask[] = [];
    for (const p of this.projects) {
      for (const ft of flattenTasks(filterArchived(p.tasks))) {
        result.push({ task: ft.task, project: p, depth: ft.depth, parentId: ft.parentId, visible: ft.visible });
      }
    }
    return result;
  }

  private refreshTable(): void {
    if (this.tableBody) {
      this.fillTableBody();
    } else {
      this.render();
    }
  }

  private renderFilterBar(): void {
    const bar = this.container.createDiv('pm-filter-bar');

    const search = bar.createEl('input', {
      type: 'text',
      placeholder: 'Search tasks…',
      cls: 'pm-filter-input',
    });
    search.value = this.filter.text;
    search.addEventListener('input', () => {
      this.filter.text = search.value;
      this.refreshTable();
    });

    renderFilterDropdown(bar, 'Status', this.filter.statuses,
      this.plugin.settings.statuses.map(s => ({ id: s.id, label: formatBadgeText(s.icon, s.label) })),
      (selected) => { this.filter.statuses = selected; this.render(); });

    renderFilterDropdown(bar, 'Priority', this.filter.priorities,
      this.plugin.settings.priorities.map(p => ({ id: p.id, label: formatBadgeText(p.icon, p.label) })),
      (selected) => { this.filter.priorities = selected as TaskPriority[]; this.render(); });

    const allAssignees = new Set<string>();
    const allTags = new Set<string>();
    for (const p of this.projects) {
      for (const a of collectAllAssignees(p.tasks)) allAssignees.add(a);
      for (const t of collectAllTags(p.tasks)) allTags.add(t);
    }
    if (allAssignees.size) {
      renderFilterDropdown(bar, 'Assignee', this.filter.assignees,
        [...allAssignees].map(a => ({ id: a, label: a })),
        (selected) => { this.filter.assignees = selected; this.render(); });
    }
    if (allTags.size) {
      renderFilterDropdown(bar, 'Tag', this.filter.tags,
        [...allTags].map(t => ({ id: t, label: t })),
        (selected) => { this.filter.tags = selected; this.render(); });
    }

    renderFilterDropdown(bar, 'Project', this.projectFilter,
      this.projects.map(p => ({ id: p.id, label: p.title })),
      (selected) => { this.projectFilter = selected; this.render(); });

    const dueDateLabels: Record<DueDateFilter, string> = {
      any: 'Due date', overdue: 'Overdue', 'this-week': 'This week',
      'this-month': 'This month', 'no-date': 'No date',
    };
    const dueBtn = bar.createEl('button', {
      text: this.filter.dueDateFilter !== 'any' ? `Due: ${dueDateLabels[this.filter.dueDateFilter]}` : 'Due date',
      cls: 'pm-filter-dropdown-btn',
    });
    if (this.filter.dueDateFilter !== 'any') dueBtn.addClass('pm-filter-dropdown-btn--active');
    dueBtn.addEventListener('click', (e) => {
      const menu = new Menu();
      for (const opt of ['any', 'overdue', 'this-week', 'this-month', 'no-date'] as DueDateFilter[]) {
        menu.addItem(item => item
          .setTitle(dueDateLabels[opt])
          .setChecked(this.filter.dueDateFilter === opt)
          .onClick(() => { this.filter.dueDateFilter = opt; this.render(); }));
      }
      menu.showAtMouseEvent(e);
    });

    const activeCount = this.countActiveFilters();
    if (activeCount > 0) {
      const clearBtn = bar.createEl('button', { text: `✕ Clear (${activeCount})`, cls: 'pm-btn pm-btn-ghost pm-btn-sm' });
      clearBtn.addEventListener('click', () => {
        this.filter = makeDefaultFilter();
        this.projectFilter = [];
        this.render();
      });
    }
  }

  private countActiveFilters(): number {
    let n = 0;
    if (this.filter.text) n++;
    if (this.filter.statuses.length) n++;
    if (this.filter.priorities.length) n++;
    if (this.filter.assignees.length) n++;
    if (this.filter.tags.length) n++;
    if (this.filter.dueDateFilter !== 'any') n++;
    if (this.projectFilter.length) n++;
    return n;
  }

  private renderTaskTable(): void {
    const wrapper = this.container.createDiv('pm-table-wrapper');
    const table = wrapper.createEl('table', { cls: 'pm-table' });
    const thead = table.createEl('thead');
    const hrow = thead.createEl('tr');

    hrow.createEl('th', { cls: 'pm-table-cell-expand pm-th-expand' });

    const cols: { key: TaskSortKey | null; label: string; cls: string }[] = [
      { key: 'project',   label: 'Project',   cls: 'pm-th-project'   },
      { key: 'title',     label: 'Task',       cls: 'pm-th-title'     },
      { key: 'status',    label: 'Status',     cls: 'pm-th-status'    },
      { key: 'priority',  label: 'Priority',   cls: 'pm-th-priority'  },
      { key: 'assignees', label: 'Assignees',  cls: 'pm-th-assignees' },
      { key: 'due',       label: 'Due',        cls: 'pm-th-due'       },
      { key: 'progress',  label: 'Progress',   cls: 'pm-th-progress'  },
      { key: null,        label: 'Time',       cls: 'pm-th-time'      },
    ];

    for (const col of cols) {
      const th = hrow.createEl('th', { cls: col.cls });
      if (col.key) {
        th.addClass('pm-table-th-sortable');
        th.setAttribute('role', 'button');
        th.createEl('span', { text: col.label });
        if (this.taskSortKey === col.key) {
          th.createEl('span', { text: this.taskSortDir === 'asc' ? ' ↑' : ' ↓', cls: 'pm-sort-indicator' });
        }
        const key = col.key;
        th.addEventListener('click', () => {
          if (this.taskSortKey === key) {
            this.taskSortDir = this.taskSortDir === 'asc' ? 'desc' : 'asc';
          } else {
            this.taskSortKey = key;
            this.taskSortDir = 'asc';
          }
          this.fillTableBody();
        });
      } else {
        th.setText(col.label);
      }
    }
    hrow.createEl('th', { cls: 'pm-th-actions' });

    this.tableBody = table.createEl('tbody');
    this.fillTableBody();
  }

  private fillTableBody(): void {
    if (!this.tableBody) return;
    this.tableBody.empty();

    let items = this.getAllFlatTasks();

    if (this.projectFilter.length) {
      items = items.filter(i => this.projectFilter.includes(i.project.id));
    }

    const asFlatTasks: FlatTask[] = items.map(i => ({
      task: i.task, depth: i.depth, parentId: i.parentId, visible: i.visible,
    }));
    const filteredFlat = applyFilters(asFlatTasks, this.filter, this.plugin.settings.statuses);
    const filteredIds = new Set(filteredFlat.map(f => f.task.id));
    items = items.filter(i => filteredIds.has(i.task.id));

    items.sort((a, b) => {
      const dir = this.taskSortDir === 'asc' ? 1 : -1;
      switch (this.taskSortKey) {
        case 'project':   return dir * a.project.title.localeCompare(b.project.title);
        case 'title':     return dir * a.task.title.localeCompare(b.task.title);
        case 'status':    return dir * a.task.status.localeCompare(b.task.status);
        case 'priority':  return dir * (priorityOrder(a.task.priority) - priorityOrder(b.task.priority));
        case 'due':       return dir * (a.task.due || 'zzz').localeCompare(b.task.due || 'zzz');
        case 'assignees': return dir * (a.task.assignees[0] ?? '').localeCompare(b.task.assignees[0] ?? '');
        case 'progress':  return dir * (a.task.progress - b.task.progress);
        default: return 0;
      }
    });

    for (const item of items) {
      this.renderTaskRow(item);
    }

    if (items.length === 0) {
      const tr = this.tableBody.createEl('tr');
      const td = tr.createEl('td', { attr: { colspan: '10' } });
      td.addClass('pm-table-empty-cell');
      td.setText(this.countActiveFilters() > 0
        ? 'No tasks match the current filters.'
        : 'No tasks across all projects.');
    }
  }

  private renderTaskRow(item: GlobalFlatTask): void {
    const { task, project, depth } = item;
    const isDone = isTerminalStatus(task.status, this.plugin.settings.statuses);

    const row = this.tableBody!.createEl('tr', { cls: 'pm-table-row' });
    row.dataset.taskId = task.id;
    if (isDone) row.addClass('pm-table-row--done');
    row.style.setProperty('--depth', String(depth));

    // Expand / subtask indicator
    const expandCell = row.createEl('td', { cls: 'pm-table-cell-expand' });
    if (task.subtasks.length > 0) {
      expandCell.createEl('span', { text: String(task.subtasks.length), cls: 'pm-subtask-count-badge' });
    }

    // Project cell
    const projectCell = row.createEl('td', { cls: 'pm-global-table-project-cell' });
    const badge = projectCell.createDiv('pm-global-project-badge');
    badge.title = project.title;
    const dot = badge.createEl('span', { cls: 'pm-global-project-dot' });
    dot.style.background = project.color;
    badge.createEl('span', { text: project.title, cls: 'pm-global-project-name' });
    badge.addEventListener('click', safeAsync(async (e: MouseEvent) => {
      e.stopPropagation();
      const file = this.plugin.app.vault.getAbstractFileByPath(project.filePath);
      if (file instanceof TFile) await this.plugin.openProjectFile(file);
    }));

    // Title cell
    const titleCell = row.createEl('td', { cls: 'pm-table-cell-title' });
    titleCell.style.paddingLeft = `${depth * 18 + 8}px`;
    const titleText = titleCell.createEl('span', { text: task.title, cls: 'pm-task-title-text' });
    titleText.addEventListener('click', () => {
      openTaskModal(this.plugin, project, { task, onSave: async () => { await this.onRefreshAll(); } });
    });
    if (task.type === 'milestone') {
      titleCell.createEl('span', { text: 'M', cls: 'pm-task-badge pm-task-badge--milestone', attr: { title: 'Milestone' } });
    }
    if (task.recurrence) {
      titleCell.createEl('span', { text: 'R', cls: 'pm-task-badge pm-task-badge--recurrence', attr: { title: 'Recurring' } });
    }

    // Status cell
    const statusCell = row.createEl('td', { cls: 'pm-table-cell-status' });
    renderStatusBadge(statusCell, task, this.plugin.settings.statuses, safeAsync(async (status: TaskStatus) => {
      task.status = status;
      await this.plugin.store.updateTask(project, task.id, { status });
      if (this.plugin.settings.autoSchedule) {
        await this.plugin.store.scheduleAfterChange(project, task.id, this.plugin.settings.statuses);
      }
      await this.onRefreshAll();
    }));

    // Priority cell
    const priorityCell = row.createEl('td', { cls: 'pm-table-cell-priority' });
    renderPriorityBadge(priorityCell, task, this.plugin.settings.priorities, safeAsync(async (priority: TaskPriority) => {
      task.priority = priority;
      await this.plugin.store.updateTask(project, task.id, { priority });
      await this.onRefreshAll();
    }));

    // Assignees cell
    const assigneesCell = row.createEl('td', { cls: 'pm-table-cell-assignees' });
    for (const a of task.assignees.slice(0, 3)) {
      const av = assigneesCell.createEl('span', { cls: 'pm-avatar pm-avatar--sm' });
      av.textContent = a.slice(0, 2).toUpperCase();
      av.title = a;
      av.style.background = stringToColor(a);
    }
    if (task.assignees.length > 3) {
      assigneesCell.createEl('span', {
        text: `+${task.assignees.length - 3}`,
        cls: 'pm-avatar pm-avatar--sm pm-avatar--more',
      });
    }

    // Due date cell
    const dueCell = row.createEl('td', { cls: 'pm-table-cell-due' });
    if (task.due) {
      const overdue = isTaskOverdue(task, this.plugin.settings.statuses);
      const chip = dueCell.createEl('span', { text: formatDateShort(task.due), cls: 'pm-due-chip' });
      if (overdue) chip.addClass('pm-due-chip--overdue');
    }

    // Progress cell
    const progressCell = row.createEl('td', { cls: 'pm-table-cell-progress' });
    const pbar = progressCell.createDiv('pm-progress-bar');
    const pfill = pbar.createDiv('pm-progress-bar-fill');
    pfill.style.width = `${task.progress}%`;
    pfill.style.background = project.color;
    progressCell.createEl('span', { text: `${task.progress}%`, cls: 'pm-progress-text' });

    // Time cell
    const timeCell = row.createEl('td', { cls: 'pm-table-cell-time' });
    const logged = totalLoggedHours(task);
    const est = task.timeEstimate ?? 0;
    if (logged > 0 || est > 0) {
      const chip = timeCell.createEl('span', { cls: 'pm-time-chip' });
      chip.setText(est > 0 ? `${logged}/${est}h` : `${logged}h`);
      if (est > 0 && logged > est) chip.addClass('pm-time-chip--over');
    }

    // Actions cell
    const actionsCell = row.createEl('td', { cls: 'pm-table-cell-actions' });
    const actBtn = actionsCell.createEl('button', { cls: 'pm-icon-btn', attr: { 'aria-label': 'Task actions' } });
    actBtn.setText('⋮');
    actBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = new Menu();
      buildTaskContextMenu(menu, task, { plugin: this.plugin, project, onRefresh: this.onRefreshAll });
      menu.showAtMouseEvent(e);
    });

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const menu = new Menu();
      buildTaskContextMenu(menu, task, { plugin: this.plugin, project, onRefresh: this.onRefreshAll });
      menu.showAtMouseEvent(e);
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTableDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
}

import { TFile, Menu } from 'obsidian';
import type PMPlugin from '../main';
import type { Project, Task, StatusConfig, GlobalViewMode } from '../types';
import { safeAsync, isTerminalStatus, resolveProjectDates, computeProjectSpent, fmtNum } from '../utils';
import { openProjectModal } from '../ui/ModalFactory';
import { projectStatusColor } from '../modals/ProjectModal';
import { openGroupClientModal } from '../modals/GroupClientModal';
import { GlobalTableView } from './GlobalTableView';
import { GlobalKanbanView } from './GlobalKanbanView';
import { GlobalGanttView } from './GlobalGanttView';
import { renderProjectFilterBar, applyProjectFilters, countActiveProjectFilters } from './ProjectFilterBar';
import type { SubView } from './SubView';

export interface ProjectListContext {
  plugin: PMPlugin;
  toolbarEl: HTMLElement;
  contentEl: HTMLElement;
  isStale: () => boolean;
  openProjectFile: (file: TFile) => Promise<void>;
  globalView: GlobalViewMode;
  onGlobalViewChange: (v: GlobalViewMode) => void;
  onRefreshAll: () => Promise<void>;
  setGlobalSubview: (sv: SubView | null) => void;
}

export function renderProjectListToolbar(ctx: ProjectListContext): void {
  ctx.toolbarEl.empty();

  // Left: title
  const left = ctx.toolbarEl.createDiv('pm-toolbar-left');
  left.createEl('h2', { text: 'Project manager', cls: 'pm-toolbar-title' });

  // Center: view switcher (Cards | Table | Gantt | Board)
  const switcher = ctx.toolbarEl.createDiv('pm-view-switcher');
  const views: { mode: GlobalViewMode; icon: string; label: string }[] = [
    { mode: 'cards',  icon: '⊞', label: 'Cards'  },
    { mode: 'table',  icon: '≡', label: 'Table'  },
    { mode: 'gantt',  icon: '▬', label: 'Gantt'  },
    { mode: 'kanban', icon: '⊟', label: 'Board'  },
  ];
  for (const v of views) {
    const btn = switcher.createEl('button', {
      cls: 'pm-view-btn',
      attr: { 'aria-label': `Switch to ${v.label} view` },
    });
    btn.createEl('span', { text: v.icon, cls: 'pm-view-btn-icon' });
    btn.createEl('span', { text: v.label });
    if (v.mode === ctx.globalView) btn.addClass('pm-view-btn--active');
    btn.addEventListener('click', () => ctx.onGlobalViewChange(v.mode));
  }

  // Right: portfolio / client / project actions
  const right = ctx.toolbarEl.createDiv('pm-toolbar-right');

  const groupBtn = right.createEl('button', { text: '+ new portfolio', cls: 'pm-btn pm-btn-ghost pm-btn-sm' });
  groupBtn.addEventListener('click', () => {
    // Load all projects at call time so counts are fresh
    void ctx.plugin.store.loadAllProjects(ctx.plugin.settings.projectsFolder).then(projects => {
      openGroupClientModal(ctx.plugin, projects, 'portfolios', () => { void ctx.onRefreshAll(); });
    });
  });

  const clientBtn = right.createEl('button', { text: '+ new client', cls: 'pm-btn pm-btn-ghost pm-btn-sm' });
  clientBtn.addEventListener('click', () => {
    void ctx.plugin.store.loadAllProjects(ctx.plugin.settings.projectsFolder).then(projects => {
      openGroupClientModal(ctx.plugin, projects, 'clients', () => { void ctx.onRefreshAll(); });
    });
  });

  const newBtn = right.createEl('button', { text: '+ new project', cls: 'pm-btn pm-btn-primary' });
  newBtn.addEventListener('click', () => {
    openProjectModal(ctx.plugin, { onSave: async project => {
      const file = ctx.plugin.app.vault.getAbstractFileByPath(project.filePath);
      if (file instanceof TFile) await ctx.openProjectFile(file);
    } });
  });
}

export async function renderProjectListContent(ctx: ProjectListContext): Promise<void> {
  const allProjects = await ctx.plugin.store.loadAllProjects(ctx.plugin.settings.projectsFolder);
  if (ctx.isStale()) return;

  ctx.contentEl.empty();
  ctx.contentEl.removeClass(
    'pm-project-list-container',
    'pm-global-view-container',
    'pm-global-view-with-filter',
  );
  ctx.setGlobalSubview(null);

  // ── Project filter bar (all views) ─────────────────────────────────────────
  const filterBarEl = ctx.contentEl.createDiv('pm-project-filter-bar-wrap');
  const onChange = () => {
    void ctx.plugin.saveSettings();
    void renderProjectListContent(ctx);
  };
  renderProjectFilterBar(filterBarEl, allProjects, ctx.plugin, onChange);

  // Apply filters; show active-filter indicator on bar wrapper
  const projects = applyProjectFilters(allProjects, ctx.plugin.settings.projectFilterState);
  const activeFilters = countActiveProjectFilters(ctx.plugin.settings.projectFilterState);
  if (activeFilters > 0) filterBarEl.addClass('pm-project-filter-bar-wrap--active');

  // ── Render selected view ───────────────────────────────────────────────────
  const viewEl = ctx.contentEl.createDiv('pm-global-view-area');

  if (ctx.globalView === 'cards') {
    viewEl.addClass('pm-project-list-container');
    renderCards(ctx, projects, viewEl);
  } else {
    viewEl.addClass('pm-global-view-container');
    let sv: SubView;
    if (ctx.globalView === 'table') {
      sv = new GlobalTableView(viewEl, projects, ctx.plugin, ctx.onRefreshAll);
    } else if (ctx.globalView === 'kanban') {
      sv = new GlobalKanbanView(viewEl, projects, ctx.plugin, ctx.onRefreshAll);
    } else {
      sv = new GlobalGanttView(viewEl, projects, ctx.plugin, ctx.onRefreshAll);
    }
    ctx.setGlobalSubview(sv);
    sv.render();
  }
}

// ─── Card rendering ───────────────────────────────────────────────────────────

function renderCards(ctx: ProjectListContext, projects: Project[], container: HTMLElement): void {
  if (projects.length === 0) {
    const empty = container.createDiv('pm-empty-state');
    empty.createEl('div', { text: '📋', cls: 'pm-empty-icon' });
    empty.createEl('h3', { text: 'No projects yet' });
    empty.createEl('p', { text: 'Create your first project to get started.' });
    const btn = empty.createEl('button', { text: '+ new project', cls: 'pm-btn pm-btn-primary' });
    btn.addEventListener('click', () => {
      openProjectModal(ctx.plugin, { onSave: async project => {
        const file = ctx.plugin.app.vault.getAbstractFileByPath(project.filePath);
        if (file instanceof TFile) await ctx.openProjectFile(file);
      } });
    });
    return;
  }

  // Group projects
  const grouped = groupAndSort(projects);

  for (const { groupName, groupProjects } of grouped) {
    const isCollapsed = ctx.plugin.settings.collapsedGroups.includes(groupName);
    const pf = ctx.plugin.settings.portfolios.find(g => g.name === groupName);
    const groupColor  = pf?.color ?? ctx.plugin.settings.groupColors[groupName] ?? '#8b72be';

    if (groupName !== '__ungrouped__') {
      // ── Group header ───────────────────────────────────────────────────────
      const groupHeader = container.createDiv('pm-group-header');
      groupHeader.dataset.group = groupName;

      const dot = groupHeader.createEl('span', { cls: 'pm-group-dot' });
      dot.style.background = groupColor;

      groupHeader.createEl('span', { text: groupName, cls: 'pm-group-name' });
      groupHeader.createEl('span', {
        text: `${groupProjects.length}`,
        cls: 'pm-group-count',
      });

      const chevron = groupHeader.createEl('span', {
        cls: 'pm-group-chevron',
        text: isCollapsed ? '▶' : '▼',
      });

      groupHeader.addEventListener('click', () => {
        const collapsed = ctx.plugin.settings.collapsedGroups.includes(groupName);
        if (collapsed) {
          ctx.plugin.settings.collapsedGroups = ctx.plugin.settings.collapsedGroups.filter(g => g !== groupName);
          chevron.textContent = '▼';
          grid.removeClass('pm-group-collapsed');
        } else {
          ctx.plugin.settings.collapsedGroups.push(groupName);
          chevron.textContent = '▶';
          grid.addClass('pm-group-collapsed');
        }
        void ctx.plugin.saveSettings();
      });
    }

    // ── Card grid ──────────────────────────────────────────────────────────
    const grid = container.createDiv('pm-project-grid');
    if (isCollapsed) grid.addClass('pm-group-collapsed');

    for (const project of groupProjects) {
      renderProjectCard(ctx, grid, project, groupProjects);
    }
  }
}

function renderProjectCard(
  ctx: ProjectListContext,
  grid: HTMLElement,
  project: Project,
  siblings: Project[],
): void {
  const card = grid.createDiv('pm-project-card');
  card.dataset.projectId = project.id;
  card.draggable = true;
  card.style.setProperty('--pm-project-color', project.color);

  // ── Color bar ──────────────────────────────────────────────────────────────
  const colorBar = card.createDiv('pm-project-card-bar');
  colorBar.style.background = project.color;

  // ── Body ───────────────────────────────────────────────────────────────────
  const body = card.createDiv('pm-project-card-body');

  // Top row: icon + badges
  const topRow = body.createDiv('pm-project-card-top');
  topRow.createEl('div', { text: project.icon, cls: 'pm-project-card-icon' });

  const badges = topRow.createDiv('pm-project-card-badges');
  if (project.status) {
    const statusBadge = badges.createEl('span', {
      text: project.status.replace('-', ' '),
      cls: 'pm-project-status-badge',
    });
    statusBadge.style.setProperty('--badge-color', projectStatusColor(project.status));
  }
  if (project.priority) {
    const PRIORITY_COLORS: Record<string, string> = {
      critical: '#c47070', high: '#b8a06b', medium: '#8a94a0', low: '#79b58d',
    };
    const priorityBadge = badges.createEl('span', {
      text: project.priority,
      cls: 'pm-project-priority-badge',
    });
    priorityBadge.style.setProperty('--badge-color', PRIORITY_COLORS[project.priority] ?? '#8a94a0');
  }

  // Title
  body.createEl('h3', { text: project.title, cls: 'pm-project-card-title', attr: { title: project.title } });

  // Client label
  if (project.client) {
    body.createEl('div', { text: project.client, cls: 'pm-project-card-client' });
  }

  // Owner
  if (project.owner) {
    const ownerRow = body.createDiv('pm-project-card-owner');
    const avatar = ownerRow.createEl('span', { cls: 'pm-avatar pm-avatar--sm' });
    avatar.textContent = project.owner.slice(0, 2).toUpperCase();
    ownerRow.createEl('span', { text: project.owner, cls: 'pm-project-card-owner-name' });
  }

  // Task progress
  const meta = body.createDiv('pm-project-card-meta');
  const total = countTasks(project.tasks, false, ctx.plugin.settings.statuses);
  const done  = countTasks(project.tasks, true,  ctx.plugin.settings.statuses);
  meta.createEl('span', { text: `${done}/${total} tasks`, cls: 'pm-project-card-tasks' });

  // Budget
  if (project.budget !== undefined && project.budget > 0) {
    const currency = project.currency ?? ctx.plugin.settings.defaultCurrency ?? 'EUR';
    const spent = computeProjectSpent(project);
    const budgetEl = meta.createEl('span', { cls: 'pm-project-card-budget' });
    if (spent > 0) {
      budgetEl.textContent = `${currency} ${fmtNum(spent)} / ${fmtNum(project.budget)}`;
      if (spent > project.budget) budgetEl.addClass('pm-project-card-budget--over');
    } else {
      budgetEl.textContent = `${currency} ${fmtNum(project.budget)}`;
    }
  }

  const progressBar = body.createDiv('pm-project-card-progress');
  const fill = progressBar.createDiv('pm-project-card-progress-fill');
  fill.style.width     = total ? `${Math.round((done / total) * 100)}%` : '0%';
  fill.style.background = project.color;

  // Dates
  const { start, end, startAuto, endAuto } = resolveProjectDates(project);
  if (start || end) {
    const datesRow = body.createDiv('pm-project-card-dates');
    if (start) {
      const startEl = datesRow.createEl('span', { text: fmtDate(start), cls: 'pm-project-card-date' });
      if (startAuto) startEl.addClass('pm-project-card-date--auto');
    }
    if (start && end) {
      datesRow.createEl('span', { text: '→', cls: 'pm-project-card-date-sep' });
    }
    if (end) {
      const endEl = datesRow.createEl('span', { text: fmtDate(end), cls: 'pm-project-card-date' });
      if (endAuto) endEl.addClass('pm-project-card-date--auto');
      // overdue highlight
      if (new Date(end) < new Date() && project.status !== 'completed' && project.status !== 'cancelled') {
        endEl.addClass('pm-project-card-date--overdue');
      }
    }
  }

  // ── Click to open ──────────────────────────────────────────────────────────
  card.addEventListener('click', safeAsync(async () => {
    const file = ctx.plugin.app.vault.getAbstractFileByPath(project.filePath);
    if (file instanceof TFile) await ctx.openProjectFile(file);
  }));

  // ── Context menu ───────────────────────────────────────────────────────────
  card.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault();
    const menu = new Menu();
    menu.addItem(item => item.setTitle('Edit project').setIcon('settings').onClick(() => {
      openProjectModal(ctx.plugin, { project, onSave: async () => { await renderProjectListContent(ctx); } });
    }));
    menu.addItem(item => item.setTitle('Delete project').setIcon('trash').onClick(safeAsync(async () => {
      await ctx.plugin.store.deleteProject(project);
      await renderProjectListContent(ctx);
    })));
    menu.showAtMouseEvent(e);
  });

  // ── Drag-to-reorder ────────────────────────────────────────────────────────
  setupDrag(card, project, siblings, ctx);
}

// ─── Drag-and-drop ────────────────────────────────────────────────────────────

let dragSrcId: string | null = null;

function setupDrag(
  card: HTMLElement,
  project: Project,
  siblings: Project[],
  ctx: ProjectListContext,
): void {
  card.addEventListener('dragstart', (e: DragEvent) => {
    dragSrcId = project.id;
    card.addClass('pm-card-dragging');
    e.dataTransfer?.setData('text/plain', project.id);
  });

  card.addEventListener('dragend', () => {
    card.removeClass('pm-card-dragging');
    card.closest('.pm-project-grid')
      ?.querySelectorAll('.pm-card-drag-over')
      .forEach(el => el.removeClass('pm-card-drag-over'));
    dragSrcId = null;
  });

  card.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    if (dragSrcId && dragSrcId !== project.id) {
      card.addClass('pm-card-drag-over');
    }
  });

  card.addEventListener('dragleave', () => {
    card.removeClass('pm-card-drag-over');
  });

  card.addEventListener('drop', safeAsync(async (e: DragEvent) => {
    e.preventDefault();
    card.removeClass('pm-card-drag-over');
    if (!dragSrcId || dragSrcId === project.id) return;

    // Reorder: assign sortOrder values based on current DOM order, then swap
    const srcProject = siblings.find(p => p.id === dragSrcId);
    const dstProject = project;
    if (!srcProject) return;

    // Build current order list and swap positions
    const ordered = [...siblings].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const srcIdx  = ordered.findIndex(p => p.id === srcProject.id);
    const dstIdx  = ordered.findIndex(p => p.id === dstProject.id);
    if (srcIdx === -1 || dstIdx === -1) return;

    ordered.splice(srcIdx, 1);
    ordered.splice(dstIdx, 0, srcProject);

    // Assign new sortOrder values and persist
    const saves: Promise<void>[] = [];
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i].sortOrder !== i) {
        ordered[i].sortOrder = i;
        saves.push(ctx.plugin.store.saveProject(ordered[i]));
      }
    }
    await Promise.all(saves);
    await renderProjectListContent(ctx);
  }));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Group projects by their `portfolio` field, sort within each group by sortOrder */
function groupAndSort(projects: Project[]): { groupName: string; groupProjects: Project[] }[] {
  const map = new Map<string, Project[]>();

  for (const p of projects) {
    const key = p.portfolio?.trim() || '__ungrouped__';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }

  // Sort each group by sortOrder, then title
  for (const [, arr] of map) {
    arr.sort((a, b) => {
      const aOrd = a.sortOrder ?? 9999;
      const bOrd = b.sortOrder ?? 9999;
      if (aOrd !== bOrd) return aOrd - bOrd;
      return a.title.localeCompare(b.title);
    });
  }

  // Sort groups: named groups alphabetically, ungrouped last
  const keys = [...map.keys()].sort((a, b) => {
    if (a === '__ungrouped__') return 1;
    if (b === '__ungrouped__') return -1;
    return a.localeCompare(b);
  });

  return keys.map(groupName => ({ groupName, groupProjects: map.get(groupName)! }));
}

function countTasks(tasks: Task[], doneOnly: boolean, statuses: StatusConfig[]): number {
  let n = 0;
  for (const t of tasks) {
    if (!doneOnly || isTerminalStatus(t.status, statuses)) n++;
    n += countTasks(t.subtasks, doneOnly, statuses);
  }
  return n;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
}

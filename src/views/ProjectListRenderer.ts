import { TFile, Menu } from 'obsidian';
import type PMPlugin from '../main';
import type { Project, Task, StatusConfig, GlobalViewMode } from '../types';
import { safeAsync, isTerminalStatus } from '../utils';
import { openProjectModal } from '../ui/ModalFactory';
import { GlobalTableView } from './GlobalTableView';
import { GlobalKanbanView } from './GlobalKanbanView';
import { GlobalGanttView } from './GlobalGanttView';
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

  // Right: new project
  const right = ctx.toolbarEl.createDiv('pm-toolbar-right');
  const newBtn = right.createEl('button', { text: '+ new project', cls: 'pm-btn pm-btn-primary' });
  newBtn.addEventListener('click', () => {
    openProjectModal(ctx.plugin, { onSave: async project => {
      const file = ctx.plugin.app.vault.getAbstractFileByPath(project.filePath);
      if (file instanceof TFile) await ctx.openProjectFile(file);
    } });
  });
}

export async function renderProjectListContent(ctx: ProjectListContext): Promise<void> {
  const projects = await ctx.plugin.store.loadAllProjects(ctx.plugin.settings.projectsFolder);
  if (ctx.isStale()) return;

  ctx.contentEl.empty();
  ctx.contentEl.removeClass('pm-project-list-container', 'pm-global-view-container');
  ctx.setGlobalSubview(null);

  if (ctx.globalView === 'cards') {
    ctx.contentEl.addClass('pm-project-list-container');
    renderCards(ctx, projects);
  } else {
    ctx.contentEl.addClass('pm-global-view-container');
    let sv: SubView;
    if (ctx.globalView === 'table') {
      sv = new GlobalTableView(ctx.contentEl, projects, ctx.plugin, ctx.onRefreshAll);
    } else if (ctx.globalView === 'kanban') {
      sv = new GlobalKanbanView(ctx.contentEl, projects, ctx.plugin, ctx.onRefreshAll);
    } else {
      sv = new GlobalGanttView(ctx.contentEl, projects, ctx.plugin, ctx.onRefreshAll);
    }
    ctx.setGlobalSubview(sv);
    sv.render();
  }
}

function renderCards(ctx: ProjectListContext, projects: Project[]): void {
  if (projects.length === 0) {
    const empty = ctx.contentEl.createDiv('pm-empty-state');
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

  const grid = ctx.contentEl.createDiv('pm-project-grid');
  for (const project of projects) {
    const card = grid.createDiv('pm-project-card');
    card.style.setProperty('--pm-project-color', project.color);

    const colorBar = card.createDiv('pm-project-card-bar');
    colorBar.style.background = project.color;

    const body = card.createDiv('pm-project-card-body');
    body.createEl('div', { text: project.icon, cls: 'pm-project-card-icon' });
    body.createEl('h3', { text: project.title, cls: 'pm-project-card-title' });

    const meta = body.createDiv('pm-project-card-meta');
    const total = countTasks(project.tasks, false, ctx.plugin.settings.statuses);
    const done  = countTasks(project.tasks, true,  ctx.plugin.settings.statuses);
    meta.createEl('span', { text: `${done}/${total} tasks`, cls: 'pm-project-card-tasks' });

    const progressBar = body.createDiv('pm-project-card-progress');
    const fill = progressBar.createDiv('pm-project-card-progress-fill');
    fill.style.width  = total ? `${Math.round((done / total) * 100)}%` : '0%';
    fill.style.background = project.color;

    card.addEventListener('click', safeAsync(async () => {
      const file = ctx.plugin.app.vault.getAbstractFileByPath(project.filePath);
      if (file instanceof TFile) await ctx.openProjectFile(file);
    }));

    card.addEventListener('contextmenu', (e: MouseEvent) => {
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
  }
}

function countTasks(tasks: Task[], doneOnly: boolean, statuses: StatusConfig[]): number {
  let n = 0;
  for (const t of tasks) {
    if (!doneOnly || isTerminalStatus(t.status, statuses)) n++;
    n += countTasks(t.subtasks, doneOnly, statuses);
  }
  return n;
}

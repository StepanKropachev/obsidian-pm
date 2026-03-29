import type PMPlugin from '../../main';
import type { Project, Task } from '../../types';
import { moveTaskInTree } from '../../store/TaskTreeOps';
import { openTaskModal } from '../../ui/ModalFactory';
import { COLOR_MUTED } from '../../constants';
import { ROW_HEIGHT } from './TimelineConfig';

export interface LabelContext {
  plugin: PMPlugin;
  project: Project;
  onRefresh: () => Promise<void>;
}

export function renderTaskLabel(
  container: HTMLElement,
  task: Task,
  depth: number,
  _row: number,
  ctx: LabelContext,
): void {
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
    moveTaskInTree(ctx.project.tasks, draggedId, task.id, 'before');
    await ctx.plugin.store.saveProject(ctx.project);
    await ctx.onRefresh();
  });

  // Expand button
  if (task.subtasks.length > 0) {
    const btn = el.createEl('button', {
      text: task.collapsed ? '▶' : '▼',
      cls: 'pm-gantt-expand-btn',
    });
    btn.addEventListener('click', async () => {
      await ctx.plugin.store.updateTask(ctx.project, task.id, { collapsed: !task.collapsed });
      await ctx.onRefresh();
    });
  } else {
    el.createEl('span', { cls: 'pm-gantt-label-spacer' });
  }

  // Color dot
  const statusConfig = ctx.plugin.settings.statuses.find(s => s.id === task.status);
  const dot = el.createEl('span', { cls: 'pm-gantt-label-dot' });
  dot.style.background = statusConfig?.color ?? COLOR_MUTED;

  // Title
  const titleEl = el.createEl('span', { text: task.title, cls: 'pm-gantt-label-title' });
  titleEl.addEventListener('click', async () => {
    openTaskModal(ctx.plugin, ctx.project, { task, onSave: async () => { await ctx.onRefresh(); } });
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
    openTaskModal(ctx.plugin, ctx.project, { parentId: task.id, onSave: async () => { await ctx.onRefresh(); } });
  });
}

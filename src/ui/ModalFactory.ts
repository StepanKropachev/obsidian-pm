import { type App, Modal } from 'obsidian';
import type PMPlugin from '../main';
import type { Project, Task } from '../types';
import { TaskModal } from '../modals/TaskModal';
import { ProjectModal } from '../modals/ProjectModal';
import { ProjectPickerModal, TaskPickerModal } from '../modals/PickerModals';

/**
 * Opens an Obsidian-native confirmation dialog.
 * Returns a promise that resolves to true if confirmed, false if cancelled.
 */
export function confirmDialog(app: App, message: string, confirmLabel = 'Delete'): Promise<boolean> {
  return new Promise(resolve => {
    const modal = new ConfirmModal(app, message, confirmLabel, resolve);
    modal.open();
  });
}

class ConfirmModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private message: string,
    private confirmLabel: string,
    private resolve: (value: boolean) => void,
  ) {
    super(app);
  }

  private finish(value: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(value);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass('pm-confirm-modal');

    contentEl.createEl('p', {
      text: this.message,
      attr: { style: 'margin: 0 0 1rem 0; color: var(--text-normal); font-size: var(--font-ui-medium);' },
    });

    const btnRow = contentEl.createDiv({ attr: { style: 'display: flex; justify-content: flex-end; gap: 0.5rem;' } });

    const cancelBtn = btnRow.createEl('button', { text: 'Cancel', cls: 'mod-muted' });
    cancelBtn.addEventListener('click', () => { this.finish(false); this.close(); });

    const confirmBtn = btnRow.createEl('button', { text: this.confirmLabel, cls: 'mod-warning' });
    confirmBtn.style.background = 'var(--background-modifier-error)';
    confirmBtn.style.color = 'var(--text-on-accent)';
    confirmBtn.addEventListener('click', () => { this.finish(true); this.close(); });
  }

  onClose(): void {
    this.finish(false);
    this.contentEl.empty();
  }
}

/**
 * Centralized modal helpers. Instead of `new TaskModal(app, plugin, project, task, parentId, cb).open()`
 * everywhere (6 params, 14+ call sites), use `openTaskModal(plugin, project, { task, parentId, onSave })`.
 */

export interface OpenTaskModalOpts {
  task?: Task | null;
  parentId?: string | null;
  defaults?: Partial<Task>;
  onSave: (task: Task) => Promise<void>;
}

export function openTaskModal(
  plugin: PMPlugin,
  project: Project,
  opts: OpenTaskModalOpts,
): void {
  new TaskModal(
    plugin.app,
    plugin,
    project,
    opts.task ?? null,
    opts.parentId ?? null,
    opts.onSave,
    opts.defaults,
  ).open();
}

export interface OpenProjectModalOpts {
  project?: Project | null;
  onSave: (project: Project) => Promise<void>;
}

export function openProjectModal(
  plugin: PMPlugin,
  opts: OpenProjectModalOpts,
): void {
  new ProjectModal(
    plugin.app,
    plugin,
    opts.project ?? null,
    opts.onSave,
  ).open();
}

export function openProjectPicker(
  plugin: PMPlugin,
  projects: Project[],
  onChoose: (project: Project) => void,
): void {
  new ProjectPickerModal(plugin.app, projects, onChoose).open();
}

export function openTaskPicker(
  plugin: PMPlugin,
  tasks: Task[],
  onChoose: (task: Task) => void,
): void {
  new TaskPickerModal(plugin.app, tasks, onChoose).open();
}

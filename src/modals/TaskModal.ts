import { App, Modal } from 'obsidian';
import type PMPlugin from '../main';
import { Project, Task, makeTask } from '../types';
import { addTaskToTree, updateTaskInTree } from '../store/TaskTreeOps';
import { renderTaskFormFields } from './TaskFormFields';
import { renderTimeTrackingPanel } from './TimeTrackingPanel';
import { renderSubtasksPanel } from './SubtasksPanel';

export class TaskModal extends Modal {
  private task: Task;
  private isNew: boolean;
  private cancelled = false;
  private saved = false;

  constructor(
    app: App,
    private plugin: PMPlugin,
    private project: Project,
    task: Task | null,
    private parentId: string | null,
    private onSave: (task: Task) => Promise<void>,
    defaults?: Partial<Task>,
  ) {
    super(app);
    if (task) {
      this.task = JSON.parse(JSON.stringify(task));
      this.isNew = false;
    } else {
      this.task = makeTask({ status: 'todo', priority: 'medium', ...defaults });
      this.isNew = true;
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('pm-task-modal');
    this.modalEl.addClass('pm-modal');
    this.modalEl.style.cssText = 'max-width:680px;width:90vw;max-height:88vh;background:var(--background-primary) !important;color:var(--text-normal);border:1px solid rgba(0,0,0,0.06) !important;border-radius:0.5rem !important;box-shadow:0 8px 24px rgba(0,0,0,0.06) !important;';
    contentEl.style.cssText = 'display:flex;flex-direction:column;gap:0;overflow-y:auto;max-height:calc(88vh - 40px);padding:0;color:var(--text-normal);';
    this.render();
  }

  async onClose(): Promise<void> {
    if (!this.cancelled && !this.saved && this.task.title.trim()) {
      if (this.isNew) {
        addTaskToTree(this.project.tasks, this.task, this.parentId);
      } else {
        updateTaskInTree(this.project.tasks, this.task.id, this.task);
      }
      await this.plugin.store.saveProject(this.project);
      await this.onSave(this.task);
    }
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    // ── Header ──────────────────────────────────────────────────────────────
    const header = contentEl.createDiv('pm-modal-header');
    const statusConfig = this.plugin.settings.statuses.find(s => s.id === this.task.status);
    const statusDot = header.createEl('span', { cls: 'pm-modal-status-dot' });
    statusDot.style.background = statusConfig?.color ?? '#94a3b8';

    const titleInput = header.createEl('input', {
      type: 'text', cls: 'pm-modal-title-input', value: this.task.title,
    });
    titleInput.placeholder = 'Task title\u2026';
    titleInput.addEventListener('input', () => { this.task.title = titleInput.value; });
    titleInput.focus();
    titleInput.select();

    // ── Description ─────────────────────────────────────────────────────────
    const descSection = contentEl.createDiv('pm-modal-section pm-modal-desc-section');
    descSection.createEl('h4', { text: 'Description', cls: 'pm-modal-section-title' });
    const descArea = descSection.createEl('textarea', { cls: 'pm-modal-description' });
    descArea.placeholder = 'Add a description\u2026';
    descArea.value = this.task.description;
    descArea.addEventListener('input', () => {
      this.task.description = descArea.value;
    });

    // ── Properties (collapsible) ────────────────────────────────────────────
    const propsContainer = contentEl.createDiv('pm-modal-props-container');
    const propsToggle = propsContainer.createEl('button', { cls: 'pm-props-toggle-btn' });
    propsToggle.setText('Properties \u25B6');
    const props = propsContainer.createDiv('pm-modal-props pm-modal-props--collapsed');
    propsToggle.addEventListener('click', () => {
      const collapsed = props.hasClass('pm-modal-props--collapsed');
      if (collapsed) {
        props.removeClass('pm-modal-props--collapsed');
        propsToggle.setText('Properties \u25BC');
      } else {
        props.addClass('pm-modal-props--collapsed');
        propsToggle.setText('Properties \u25B6');
      }
    });

    renderTaskFormFields(props, {
      task: this.task,
      project: this.project,
      plugin: this.plugin,
      parentId: this.parentId,
      setParentId: (id) => { this.parentId = id; },
      rerender: () => this.render(),
    });

    // ── Time Tracking ───────────────────────────────────────────────────────
    renderTimeTrackingPanel(contentEl, this.task);

    // ── Subtasks ────────────────────────────────────────────────────────────
    renderSubtasksPanel(contentEl, this.task, this.plugin);

    // ── Footer ──────────────────────────────────────────────────────────────
    const footer = contentEl.createDiv('pm-modal-footer');

    if (!this.isNew) {
      const deleteBtn = footer.createEl('button', { text: 'Delete', cls: 'pm-btn pm-btn-danger' });
      deleteBtn.addEventListener('click', async () => {
        if (confirm(`Delete "${this.task.title}"?`)) {
          await this.plugin.store.deleteTask(this.project, this.task.id);
          await this.onSave(this.task);
          this.cancelled = true;
          this.close();
        }
      });
    }

    footer.createDiv('pm-footer-spacer');

    const cancelBtn = footer.createEl('button', { text: 'Cancel', cls: 'pm-btn pm-btn-ghost' });
    cancelBtn.addEventListener('click', () => { this.cancelled = true; this.close(); });

    const saveBtn = footer.createEl('button', {
      text: this.isNew ? '+ Create Task' : 'Save Changes',
      cls: 'pm-btn pm-btn-primary',
    });
    const doSave = async () => {
      if (!this.task.title.trim()) {
        titleInput.focus();
        titleInput.classList.add('pm-input-error');
        return;
      }
      if (this.isNew) {
        addTaskToTree(this.project.tasks, this.task, this.parentId);
      } else {
        updateTaskInTree(this.project.tasks, this.task.id, this.task);
      }
      await this.plugin.store.saveProject(this.project);
      await this.onSave(this.task);
      this.saved = true;
      this.close();
    };

    saveBtn.addEventListener('click', doSave);
    this.modalEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); doSave(); }
    });
  }
}

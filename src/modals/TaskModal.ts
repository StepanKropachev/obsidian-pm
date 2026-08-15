import { App, Modal } from 'obsidian'
import type PMPlugin from '../main'
import type { Project, Task } from '../types'
import { TaskEditor } from './TaskEditor'

export class TaskModal extends Modal {
  private editor: TaskEditor

  constructor(
    app: App,
    plugin: PMPlugin,
    project: Project,
    task: Task | null,
    parentId: string | null,
    onSave: (task: Task) => void | Promise<void>,
    defaults?: Partial<Task>
  ) {
    super(app)
    this.editor = new TaskEditor(
      app,
      plugin,
      project,
      task,
      parentId,
      onSave,
      { surface: 'modal', close: () => this.close(), keyScopeEl: this.modalEl },
      defaults
    )
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('pm-task-modal', 'pm-te-surface')
    this.modalEl.addClass('pm-modal', 'pm-modal--task')
    this.editor.mount(contentEl)
  }

  onClose(): void {
    this.editor.handleClose()
    this.contentEl.empty()
  }
}

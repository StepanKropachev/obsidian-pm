import { type App, ButtonComponent, Modal } from 'obsidian'
import type PMPlugin from '../main'
import type { Project, Task } from '../types'
import { flattenTasks, type ProjectRef } from '../store'
import { TaskModal } from '../modals/TaskModal'
import { PersonLookupModal, ProjectPickerModal, TaskPickerModal } from '../modals/PickerModals'
import { ImportModal } from '../modals/ImportModal'
import { ProjectCreateModal } from '../modals/ProjectCreateModal'

/** Resolves true if confirmed, false if cancelled. */
export function confirmDialog(app: App, message: string, confirmLabel = 'Delete'): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new ConfirmModal(app, message, confirmLabel, resolve)
    modal.open()
  })
}

/** Resolves to the chosen mode, or null if cancelled. */
export function confirmDuplicateSubtasks(app: App, taskTitle: string): Promise<'with-subtasks' | 'task-only' | null> {
  return new Promise((resolve) => {
    const modal = new DuplicateSubtasksModal(app, taskTitle, resolve)
    modal.open()
  })
}

/** Returns the trimmed string, or null if cancelled or empty. */
export function promptText(app: App, label: string, placeholder = '', initial = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = new TextPromptModal(app, label, placeholder, initial, resolve)
    modal.open()
  })
}

class TextPromptModal extends Modal {
  private resolved = false

  constructor(
    app: App,
    private label: string,
    private placeholder: string,
    private initial: string,
    private resolve: (value: string | null) => void
  ) {
    super(app)
  }

  private finish(value: string | null): void {
    if (this.resolved) return
    this.resolved = true
    this.resolve(value)
  }

  onOpen(): void {
    const { contentEl } = this
    this.modalEl.addClass('pm-prompt-modal')

    contentEl.createEl('p', {
      text: this.label,
      cls: 'pm-prompt-text'
    })

    const input = contentEl.createEl('input', {
      type: 'text',
      placeholder: this.placeholder,
      cls: 'pm-prompt-input'
    })
    input.value = this.initial

    const btnRow = contentEl.createDiv('pm-modal-btn-row')

    new ButtonComponent(btnRow).setButtonText('Cancel').onClick(() => {
      this.finish(null)
      this.close()
    })

    const submit = () => {
      const val = input.value.trim()
      this.finish(val || null)
      this.close()
    }

    new ButtonComponent(btnRow).setButtonText('OK').setCta().onClick(submit)

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        submit()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        this.finish(null)
        this.close()
      }
    })

    window.setTimeout(() => {
      input.focus()
      if (this.initial) input.select()
    }, 10)
  }

  onClose(): void {
    this.finish(null)
    this.contentEl.empty()
  }
}

class ConfirmModal extends Modal {
  private resolved = false

  constructor(
    app: App,
    private message: string,
    private confirmLabel: string,
    private resolve: (value: boolean) => void
  ) {
    super(app)
  }

  private finish(value: boolean): void {
    if (this.resolved) return
    this.resolved = true
    this.resolve(value)
  }

  onOpen(): void {
    const { contentEl } = this
    this.modalEl.addClass('pm-confirm-modal')

    contentEl.createEl('p', {
      text: this.message,
      cls: 'pm-confirm-text'
    })

    const btnRow = contentEl.createDiv('pm-modal-btn-row')

    new ButtonComponent(btnRow).setButtonText('Cancel').onClick(() => {
      this.finish(false)
      this.close()
    })

    new ButtonComponent(btnRow)
      .setButtonText(this.confirmLabel)
      .setDestructive()
      .onClick(() => {
        this.finish(true)
        this.close()
      })
  }

  onClose(): void {
    this.finish(false)
    this.contentEl.empty()
  }
}

class DuplicateSubtasksModal extends Modal {
  private resolved = false

  constructor(
    app: App,
    private taskTitle: string,
    private resolve: (value: 'with-subtasks' | 'task-only' | null) => void
  ) {
    super(app)
  }

  private finish(value: 'with-subtasks' | 'task-only' | null): void {
    if (this.resolved) return
    this.resolved = true
    this.resolve(value)
  }

  onOpen(): void {
    const { contentEl } = this
    this.modalEl.addClass('pm-confirm-modal')

    contentEl.createEl('p', {
      text: `Duplicate "${this.taskTitle}" with its subtasks?`,
      cls: 'pm-confirm-text'
    })

    const btnRow = contentEl.createDiv('pm-modal-btn-row')

    new ButtonComponent(btnRow).setButtonText('Cancel').onClick(() => {
      this.finish(null)
      this.close()
    })

    new ButtonComponent(btnRow).setButtonText('Task only').onClick(() => {
      this.finish('task-only')
      this.close()
    })

    new ButtonComponent(btnRow)
      .setButtonText('With subtasks')
      .setCta()
      .onClick(() => {
        this.finish('with-subtasks')
        this.close()
      })
  }

  onClose(): void {
    this.finish(null)
    this.contentEl.empty()
  }
}

/** Every modal is opened through these, never by constructing the class directly. */

export interface OpenTaskModalOpts {
  task?: Task | null
  parentId?: string | null
  defaults?: Partial<Task>
  onSave: (task: Task) => void | Promise<void>
}

export function openTaskModal(plugin: PMPlugin, project: Project, opts: OpenTaskModalOpts): void {
  // A tab is addressed by path, so a task with no note of its own still needs the modal.
  const canOpenTab = !opts.task || Boolean(opts.task.filePath)
  if (plugin.settings.taskEditorSurface === 'tab' && canOpenTab) {
    void plugin.router.openTask(
      opts.task?.filePath
        ? { filePath: opts.task.filePath }
        : { projectPath: project.filePath, parentId: opts.parentId ?? null, defaults: opts.defaults }
    )
    return
  }
  const open = (): void => {
    new TaskModal(
      plugin.app,
      plugin,
      project,
      opts.task ?? null,
      opts.parentId ?? null,
      opts.onSave,
      opts.defaults
    ).open()
  }
  // Tasks loaded via metadataCache have an empty description until the body is read;
  // pre-loading it lets the modal paint the real one once.
  if (opts.task) {
    const task = opts.task
    void (async () => {
      await plugin.store.loadTaskBody(task)
      open()
    })()
  } else {
    open()
  }
}

/**
 * Opens the editor for a task addressed by its note, loading the project it belongs to.
 * What a link to a task leads to: the task, not the markdown behind it.
 */
export async function openTaskByPath(plugin: PMPlugin, filePath: string, onSave?: () => void): Promise<void> {
  if (plugin.settings.taskEditorSurface === 'tab') {
    await plugin.router.openTask({ filePath })
    return
  }
  const projectPath = plugin.index.projectPathForTask(filePath)
  const project = projectPath ? await plugin.store.loadProjectByPath(projectPath) : null
  const task = project ? (flattenTasks(project.tasks).find((f) => f.task.filePath === filePath)?.task ?? null) : null
  if (!project || !task) {
    await plugin.openAsMarkdown(filePath)
    return
  }
  openTaskModal(plugin, project, { task, onSave: () => onSave?.() })
}

export function openProjectCreate(plugin: PMPlugin): void {
  new ProjectCreateModal(plugin.app, plugin).open()
}

export function openProjectPicker(
  plugin: PMPlugin,
  projects: ProjectRef[],
  onChoose: (project: ProjectRef) => void
): void {
  new ProjectPickerModal(plugin.app, projects, onChoose).open()
}

export function openTaskPicker(plugin: PMPlugin, tasks: Task[], onChoose: (task: Task) => void): void {
  new TaskPickerModal(plugin.app, tasks, onChoose).open()
}

/** Picks from the people already assigned somewhere, for looking up their tasks. */
export function openPersonLookup(plugin: PMPlugin, people: string[], onChoose: (person: string) => void): void {
  new PersonLookupModal(plugin.app, people, onChoose).open()
}

export function openImportModal(
  plugin: PMPlugin,
  project: Project,
  onImportComplete?: () => void | Promise<void>
): void {
  const modal = new ImportModal(plugin.app, plugin)
  modal.setProject(project)
  if (onImportComplete) {
    modal.setOnImportComplete(() => {
      void onImportComplete()
    })
  }
  modal.open()
}

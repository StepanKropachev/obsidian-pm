import { ItemView, WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '../main'
import type { Task } from '../types'
import { flattenTasks } from '../store'
import { EmptyState } from '../ui/primitives/EmptyState'
import { truncateTitle } from '../utils'
import { TaskEditor } from '../modals/TaskEditor'

export const PM_TASK_VIEW_TYPE = 'pm-task'

/** `filePath` addresses an existing task note; a new task has only its project and parent. */
export interface TaskViewState {
  filePath?: string
  projectPath?: string
  parentId?: string | null
  defaults?: Partial<Task>
  [key: string]: unknown
}

export class TaskView extends ItemView {
  plugin: PMPlugin
  private editor: TaskEditor | null = null
  private state: TaskViewState = {}
  private taskTitle = 'Task'

  constructor(leaf: WorkspaceLeaf, plugin: PMPlugin) {
    super(leaf)
    this.plugin = plugin
    this.navigation = false
  }

  getViewType(): string {
    return PM_TASK_VIEW_TYPE
  }
  getDisplayText(): string {
    return truncateTitle(this.taskTitle, 10)
  }
  getIcon(): string {
    return 'square-check-big'
  }

  async setState(state: TaskViewState, result: unknown): Promise<void> {
    const same = state.filePath && state.filePath === this.state.filePath && this.editor
    this.state = state
    if (!same) await this.loadTask()
    await super.setState(state, result as import('obsidian').ViewStateResult)
  }

  getState(): TaskViewState {
    return this.state
  }

  onOpen(): Promise<void> {
    this.contentEl.addClass('pm-te-view', 'pm-te-surface')
    return Promise.resolve()
  }

  onClose(): Promise<void> {
    this.editor?.handleClose()
    this.editor = null
    this.contentEl.empty()
    return Promise.resolve()
  }

  private async loadTask(): Promise<void> {
    this.editor?.handleClose()
    this.editor = null
    this.contentEl.empty()

    const { filePath, projectPath, parentId, defaults } = this.state
    const resolvedProjectPath = projectPath ?? (filePath ? this.plugin.index.projectPathForTask(filePath) : null)
    const project = resolvedProjectPath ? await this.plugin.store.loadProjectByPath(resolvedProjectPath) : null
    if (!project) {
      this.showMissing('This note does not belong to a project.')
      return
    }

    let task: Task | null = null
    if (filePath) {
      task = flattenTasks(project.tasks).find((f) => f.task.filePath === filePath)?.task ?? null
      if (!task) {
        this.showMissing(`This note is not a task in ${project.title}.`)
        return
      }
      await this.plugin.store.loadTaskBody(task)
    }

    this.taskTitle = task?.title ?? 'New task'
    this.editor = new TaskEditor(
      this.app,
      this.plugin,
      project,
      task,
      parentId ?? null,
      () => {},
      { surface: 'tab', close: () => this.leaf.detach(), keyScopeEl: this.containerEl },
      defaults
    )
    this.editor.mount(this.contentEl)
  }

  private showMissing(message: string): void {
    this.taskTitle = 'Task'
    new EmptyState(this.contentEl).setIcon('square-check-big').setTitle('No task here').setBody(message)
  }
}

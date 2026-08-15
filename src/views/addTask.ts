import { Menu } from 'obsidian'
import type PMPlugin from '../main'
import type { ProjectScope } from '../store'
import type { Project, Task } from '../types'
import { openTaskModal } from '../ui/ModalFactory'

export interface AddTaskOptions {
  defaults?: Partial<Task>
  parentId?: string | null
  onSave: () => void | Promise<void>
  /** Anchors the project menu when the view covers more than one project. */
  event?: MouseEvent
}

/**
 * Opens the task editor for a new task. With several projects in view the task has to
 * say which one it belongs to, so the choice is asked for rather than guessed.
 */
export function openAddTask(plugin: PMPlugin, scope: ProjectScope, opts: AddTaskOptions): void {
  const open = (project: Project): void => {
    openTaskModal(plugin, project, {
      defaults: opts.defaults,
      parentId: opts.parentId ?? null,
      onSave: () => opts.onSave()
    })
  }
  const primary = scope.primary
  if (!primary) return
  if (!scope.isMulti || !opts.event) {
    open(primary)
    return
  }
  const menu = new Menu()
  for (const project of scope.projects) {
    menu.addItem((item) =>
      item
        .setTitle(project.title)
        .setIcon('plus')
        .onClick(() => open(project))
    )
  }
  menu.showAtMouseEvent(opts.event)
}

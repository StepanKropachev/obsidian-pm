import { Menu, Notice, TFile } from 'obsidian'
import type PMPlugin from '../main'
import type { Task, Project } from '../types'
import { safeAsync } from '../utils'
import { openTaskModal, confirmDialog, confirmDuplicateSubtasks, openProjectPicker } from './ModalFactory'

export interface TaskMenuContext {
  plugin: PMPlugin
  project: Project
  onRefresh: () => Promise<void>
}

/** Edit, Add subtask, Archive/Unarchive, Delete. */
export function buildTaskContextMenu(menu: Menu, task: Task, ctx: TaskMenuContext): Menu {
  menu.addItem((item) =>
    item
      .setTitle('Edit task')
      .setIcon('pencil')
      .onClick(() => {
        openTaskModal(ctx.plugin, ctx.project, {
          task,
          onSave: async () => {
            await ctx.onRefresh()
          }
        })
      })
  )
  menu.addItem((item) =>
    item
      .setTitle('Add subtask')
      .setIcon('plus')
      .onClick(() => {
        openTaskModal(ctx.plugin, ctx.project, {
          parentId: task.id,
          onSave: async () => {
            await ctx.onRefresh()
          }
        })
      })
  )
  menu.addItem((item) =>
    item
      .setTitle('Duplicate task')
      .setIcon('copy')
      .onClick(
        safeAsync(async () => {
          let includeSubtasks = false
          if (task.subtasks.length > 0) {
            const choice = await confirmDuplicateSubtasks(ctx.plugin.app, task.title)
            if (choice === null) return
            includeSubtasks = choice === 'with-subtasks'
          }
          await ctx.plugin.store.duplicateTask(ctx.project, task.id, includeSubtasks)
          await ctx.onRefresh()
        })
      )
  )
  menu.addItem((item) =>
    item
      .setTitle('Move to project')
      .setIcon('folder-input')
      .onClick(() => {
        const targets = ctx.plugin.index.projectRefs().filter((ref) => ref.path !== ctx.project.filePath)
        if (!targets.length) {
          new Notice('There is no other project to move this task to.')
          return
        }
        openProjectPicker(
          ctx.plugin,
          targets,
          safeAsync(async (ref) => {
            const file = ctx.plugin.app.vault.getAbstractFileByPath(ref.path)
            const target = file instanceof TFile ? await ctx.plugin.store.loadProject(file) : null
            if (!target) return
            await ctx.plugin.store.moveTaskToProject(ctx.project, target, task.id)
            new Notice(`Moved "${task.title}" to ${target.title}`)
            await ctx.onRefresh()
          })
        )
      })
  )
  menu.addSeparator()
  if (task.archived) {
    menu.addItem((item) =>
      item
        .setTitle('Unarchive')
        .setIcon('archive-restore')
        .onClick(
          safeAsync(async () => {
            await ctx.plugin.store.unarchiveTask(ctx.project, task.id)
            new Notice('Task unarchived')
            await ctx.onRefresh()
          })
        )
    )
  } else {
    menu.addItem((item) =>
      item
        .setTitle('Archive')
        .setIcon('archive')
        .onClick(
          safeAsync(async () => {
            await ctx.plugin.store.archiveTask(ctx.project, task.id)
            new Notice('Task archived')
            await ctx.onRefresh()
          })
        )
    )
  }
  menu.addItem((item) =>
    item
      .setTitle('Delete task')
      .setIcon('trash')
      .onClick(
        safeAsync(async () => {
          if (await confirmDialog(ctx.plugin.app, `Delete "${task.title}"?`)) {
            await ctx.plugin.store.deleteTask(ctx.project, task.id)
            await ctx.onRefresh()
          }
        })
      )
  )
  return menu
}

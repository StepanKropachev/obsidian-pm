import type { App } from 'obsidian'
import { TFile, normalizePath } from 'obsidian'
import type { Project, Task } from '../types'
import { findTaskById } from './TaskIndex'
import { ensureFolder, moveTaskAttachmentFolder } from './vaultFs'

/** Get the task subfolder path for a project */
function projectTaskFolder(project: Project): string {
  return project.filePath.replace(/\.md$/, '_tasks')
}

function subtree(task: Task): Task[] {
  return [task, ...task.subtasks.flatMap(subtree)]
}

/** Move a task's file (and attachments) into `targetFolder`. Reports whether the file ended up there. */
async function moveTaskFile(app: App, task: Task, targetFolder: string): Promise<boolean> {
  if (!task.filePath) return false

  const fileName = task.filePath.split('/').pop()
  if (!fileName) return false
  const newPath = normalizePath(targetFolder + '/' + fileName)
  if (newPath === task.filePath) return true

  const file = app.vault.getAbstractFileByPath(task.filePath)
  if (!(file instanceof TFile)) return false

  const oldPath = task.filePath
  await app.vault.rename(file, newPath)
  await moveTaskAttachmentFolder(app, oldPath, newPath)
  task.filePath = newPath
  return true
}

export async function archiveTask(app: App, project: Project, taskId: string): Promise<void> {
  const task = findTaskById(project, taskId)
  if (!task) return

  const archiveFolder = normalizePath(projectTaskFolder(project) + '/Archive')
  await ensureFolder(app, archiveFolder)

  for (const t of subtree(task)) {
    if (await moveTaskFile(app, t, archiveFolder)) t.archived = true
  }
}

export async function unarchiveTask(app: App, project: Project, taskId: string): Promise<void> {
  const task = findTaskById(project, taskId)
  if (!task) return

  const taskFolder = normalizePath(projectTaskFolder(project))
  for (const t of subtree(task)) {
    if (await moveTaskFile(app, t, taskFolder)) t.archived = false
  }
}

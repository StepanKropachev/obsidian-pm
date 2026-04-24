import { TFile, normalizePath } from 'obsidian'
import type { App } from 'obsidian'
import type { Project } from '../types'
import { findTask } from './TaskTreeOps'
import { ensureFolder } from './vaultFs'

/** Get the task subfolder path for a project */
function projectTaskFolder(project: Project): string {
  return project.filePath.replace(/\.md$/, '_tasks')
}

export async function archiveTask(app: App, project: Project, taskId: string): Promise<void> {
  const task = findTask(project.tasks, taskId)
  if (!task || !task.filePath) return

  const taskFolder = projectTaskFolder(project)
  const archiveFolder = normalizePath(taskFolder + '/Archive')
  await ensureFolder(app, archiveFolder)

  const fileName = task.filePath.split('/').pop()!
  const newPath = normalizePath(archiveFolder + '/' + fileName)

  const file = app.vault.getAbstractFileByPath(task.filePath)
  if (file instanceof TFile) {
    await app.vault.rename(file, newPath)
    task.filePath = newPath
    task.archived = true
  }
}

export async function unarchiveTask(app: App, project: Project, taskId: string): Promise<void> {
  const task = findTask(project.tasks, taskId)
  if (!task || !task.filePath) return

  const taskFolder = projectTaskFolder(project)
  const fileName = task.filePath.split('/').pop()!
  const newPath = normalizePath(taskFolder + '/' + fileName)

  const file = app.vault.getAbstractFileByPath(task.filePath)
  if (file instanceof TFile) {
    await app.vault.rename(file, newPath)
    task.filePath = newPath
    task.archived = false
  }
}

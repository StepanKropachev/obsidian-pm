import type { App } from 'obsidian'
import { TFile, normalizePath } from 'obsidian'
import type { Project } from '../types'
import { findTaskById } from './TaskIndex'
import { ensureFolder, moveTaskAttachmentFolder } from './vaultFs'

/** Get the task subfolder path for a project */
function projectTaskFolder(project: Project): string {
  return project.filePath.replace(/\.md$/, '_tasks')
}

export async function archiveTask(app: App, project: Project, taskId: string): Promise<void> {
  const task = findTaskById(project, taskId)
  if (!task || !task.filePath) return

  const taskFolder = projectTaskFolder(project)
  const archiveFolder = normalizePath(taskFolder + '/Archive')
  await ensureFolder(app, archiveFolder)

  const fileName = task.filePath.split('/').pop()
  if (!fileName) return
  const newPath = normalizePath(archiveFolder + '/' + fileName)

  const file = app.vault.getAbstractFileByPath(task.filePath)
  if (file instanceof TFile) {
    const oldPath = task.filePath
    await app.vault.rename(file, newPath)
    await moveTaskAttachmentFolder(app, oldPath, newPath)
    task.filePath = newPath
    task.archived = true
  }
}

export async function unarchiveTask(app: App, project: Project, taskId: string): Promise<void> {
  const task = findTaskById(project, taskId)
  if (!task || !task.filePath) return

  const taskFolder = projectTaskFolder(project)
  const fileName = task.filePath.split('/').pop()
  if (!fileName) return
  const newPath = normalizePath(taskFolder + '/' + fileName)

  const file = app.vault.getAbstractFileByPath(task.filePath)
  if (file instanceof TFile) {
    const oldPath = task.filePath
    await app.vault.rename(file, newPath)
    await moveTaskAttachmentFolder(app, oldPath, newPath)
    task.filePath = newPath
    task.archived = false
  }
}

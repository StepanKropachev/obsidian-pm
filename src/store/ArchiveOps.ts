import type { App } from 'obsidian'
import { TFile, normalizePath } from 'obsidian'
import type { Project, Task } from '../types'
import { findTaskById } from './TaskIndex'
import { ensureFolder, moveTaskAttachmentFolder, projectTaskFolder } from './vaultFs'

function subtree(task: Task): Task[] {
  return [task, ...task.subtasks.flatMap(subtree)]
}

/** Marks a path we're about to write, so the move doesn't read back as an external change. */
type MarkSelfWrite = (path: string) => void

/** Moves the file and its attachments, reporting whether they ended up there. */
async function moveTaskFile(
  app: App,
  task: Task,
  targetFolder: string,
  markSelfWrite: MarkSelfWrite
): Promise<boolean> {
  if (!task.filePath) return false

  const fileName = task.filePath.split('/').pop()
  if (!fileName) return false
  const newPath = normalizePath(targetFolder + '/' + fileName)
  if (newPath === task.filePath) return true

  const file = app.vault.getAbstractFileByPath(task.filePath)
  if (!(file instanceof TFile)) return false

  const oldPath = task.filePath
  markSelfWrite(oldPath)
  markSelfWrite(newPath)
  markSelfWrite(oldPath.replace(/\.md$/, ''))
  markSelfWrite(newPath.replace(/\.md$/, ''))
  await app.vault.rename(file, newPath)
  await moveTaskAttachmentFolder(app, oldPath, newPath)
  task.filePath = newPath
  return true
}

export async function archiveTask(
  app: App,
  project: Project,
  taskId: string,
  markSelfWrite: MarkSelfWrite
): Promise<void> {
  const task = findTaskById(project, taskId)
  if (!task) return

  const archiveFolder = normalizePath(projectTaskFolder(app, project.filePath) + '/Archive')
  await ensureFolder(app, archiveFolder)

  for (const t of subtree(task)) {
    if (await moveTaskFile(app, t, archiveFolder, markSelfWrite)) t.archived = true
  }
}

export async function unarchiveTask(
  app: App,
  project: Project,
  taskId: string,
  markSelfWrite: MarkSelfWrite
): Promise<void> {
  const task = findTaskById(project, taskId)
  if (!task) return

  const taskFolder = normalizePath(projectTaskFolder(app, project.filePath))
  for (const t of subtree(task)) {
    if (await moveTaskFile(app, t, taskFolder, markSelfWrite)) t.archived = false
  }
}

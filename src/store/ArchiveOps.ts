import type { App } from 'obsidian'
import { TFile, normalizePath } from 'obsidian'
import type { Project, Task } from '../types'
import { findTaskById } from './TaskIndex'
import type { TaskRef } from './VaultIndex'
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

/** A task that is due to be archived, with every descendant that moves along with it. */
export interface ArchiveCandidate {
  rootId: string
  ids: string[]
}

function archivable(task: Task, isComplete: (status: string) => boolean, cutoff: string): boolean {
  if (task.archived) return true
  if (!isComplete(task.status)) return false
  if (!task.completed || task.completed > cutoff) return false
  return task.subtasks.every((sub) => archivable(sub, isComplete, cutoff))
}

/**
 * Top-level tasks finished on or before `cutoff`, subtree included. A subtree moves as a
 * unit, so one live descendant keeps the whole thing in place, and a task carrying no
 * completion date is never picked: there is nothing to measure its age against.
 */
export function collectArchivable(
  project: Project,
  isComplete: (status: string) => boolean,
  cutoff: string
): ArchiveCandidate[] {
  return project.tasks
    .filter((task) => !task.archived && archivable(task, isComplete, cutoff))
    .map((task) => ({
      rootId: task.id,
      ids: subtree(task)
        .filter((t) => !t.archived)
        .map((t) => t.id)
    }))
}

/**
 * Drops candidates something live still depends on. The scheduler ignores archived
 * predecessors, so archiving one would move the dates of a task nobody touched; a
 * predecessor waits until everything waiting on it is archived too.
 */
export function withoutBlockedDependents(
  candidates: ArchiveCandidate[],
  index: { allTaskRefs(): TaskRef[] }
): ArchiveCandidate[] {
  let kept = candidates
  for (;;) {
    const moving = new Set(kept.flatMap((candidate) => candidate.ids))
    const needed = new Set<string>()
    for (const ref of index.allTaskRefs()) {
      if (ref.archived || moving.has(ref.id)) continue
      for (const id of ref.dependencies) needed.add(id)
    }
    const next = kept.filter((candidate) => !candidate.ids.some((id) => needed.has(id)))
    if (next.length === kept.length) return next
    kept = next
  }
}

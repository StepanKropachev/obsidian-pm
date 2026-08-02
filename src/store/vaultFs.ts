import type { App } from 'obsidian'
import { TFolder, normalizePath } from 'obsidian'

/**
 * Keeps a task's attachment folder with its note across renames and archiving. A no-op
 * when there is no such folder or the destination is taken; returns null when nothing moved.
 */
export async function moveTaskAttachmentFolder(
  app: App,
  oldTaskFilePath: string,
  newTaskFilePath: string
): Promise<{ from: string; to: string } | null> {
  const from = normalizePath(oldTaskFilePath.replace(/\.md$/, ''))
  const to = normalizePath(newTaskFilePath.replace(/\.md$/, ''))
  if (from === to) return null
  const folder = app.vault.getAbstractFileByPath(from)
  if (!(folder instanceof TFolder)) return null
  if (app.vault.getAbstractFileByPath(to)) return null
  await app.vault.rename(folder, to)
  return { from, to }
}

/**
 * `getAbstractFileByPath` is case-sensitive while macOS and Windows filesystems are not,
 * so a settings value of `projects` misses an existing `Projects/` and `createFolder` then
 * throws "Folder already exists". Swallowing that also covers concurrent callers racing.
 */
export async function ensureFolder(app: App, folderPath: string): Promise<void> {
  const normalized = normalizePath(folderPath)
  if (app.vault.getAbstractFileByPath(normalized) instanceof TFolder) return
  try {
    await app.vault.createFolder(normalized)
  } catch (e) {
    if (!isAlreadyExistsError(e)) throw e
  }
}

function isAlreadyExistsError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /already exists/i.test(msg)
}

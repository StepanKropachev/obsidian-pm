import type { App } from 'obsidian'
import { TFolder, normalizePath } from 'obsidian'

/**
 * Move a task's attachment folder so it follows the note when the task is renamed
 * or moved between folders (e.g. archived/unarchived). The folder lives at the
 * task file path minus `.md`. No-op when the task has no attachment folder or the
 * destination is already taken. Returns the moved paths, or null if nothing moved.
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
 * Idempotently ensure a folder exists at `folderPath`.
 *
 * `getAbstractFileByPath` is case-sensitive, but macOS/Windows filesystems are
 * case-insensitive — a vault with `Projects/` and a settings value of
 * `projects` would miss the lookup and call `createFolder`, which then throws
 * "Folder already exists". We swallow that case (and also guard against
 * concurrent callers racing).
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

import { TFolder, normalizePath } from 'obsidian'
import type { App } from 'obsidian'

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

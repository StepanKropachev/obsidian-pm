import type { App } from 'obsidian'
import { TFile } from 'obsidian'

/**
 * A reference between notes is a wikilink to the target. Vaults written before that hold a
 * bare id in the same field, so every reader accepts both and only links resolve.
 */
export function isRefLink(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false
  const trimmed = raw.trim()
  return trimmed.startsWith('[[') && trimmed.endsWith(']]') && trimmed.length > 4
}

/**
 * Obsidian abbreviates a link to a bare file name only while that name is unique, and two
 * projects can each hold a task of the same title. `fileToLinktext` writes the full path
 * when they do, so the link reaches the note named rather than a nearer namesake.
 */
export function refLink(app: App, targetPath: string, title: string, sourcePath: string): string {
  const file = app.vault.getAbstractFileByPath(targetPath)
  const linktext =
    file instanceof TFile
      ? app.metadataCache.fileToLinktext(file, sourcePath)
      : targetPath.replace(/^.*\//, '').replace(/\.md$/, '')
  return `[[${linktext}|${title}]]`
}

function refTarget(app: App, raw: string, sourcePath: string): TFile | null {
  if (!isRefLink(raw)) return null
  const linkpath = raw.trim().slice(2, -2).split('|')[0].trim()
  if (!linkpath) return null
  return app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)
}

export function refToPath(app: App, raw: string, sourcePath: string): string | null {
  return refTarget(app, raw, sourcePath)?.path ?? null
}

/**
 * The id a reference points at. `idByPath` covers the notes the caller has already read,
 * which is every task in the project being loaded; anything outside it costs a cache read.
 */
export function refToId(app: App, raw: string, sourcePath: string, idByPath?: Map<string, string>): string {
  const target = refTarget(app, raw, sourcePath)
  if (!target) return raw
  const known = idByPath?.get(target.path)
  if (known) return known
  const id: unknown = app.metadataCache.getFileCache(target)?.frontmatter?.id
  return typeof id === 'string' && id ? id : raw
}

export function refListToIds(app: App, raw: string[], sourcePath: string, idByPath?: Map<string, string>): string[] {
  return raw.map((entry) => refToId(app, entry, sourcePath, idByPath))
}

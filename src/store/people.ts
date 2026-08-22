import { normalizePath, TFile, type App } from 'obsidian'
import { displayName } from '../utils'
import { ensureFolder } from './vaultFs'

/** How a stored assignee value relates to the vault. */
export type PersonLinkState = 'plain' | 'linked' | 'unresolved'

export interface PersonRef {
  /** The value as stored, a wikilink or a bare name. */
  raw: string
  name: string
  path: string | null
  state: PersonLinkState
}

function isWikilink(raw: string): boolean {
  return /^\[\[.+\]\]$/.test(raw.trim())
}

/**
 * A bare name stays plain even when a note happens to share it: the user never linked it,
 * so treating it as a link would claim a connection the vault does not have.
 */
export function resolvePerson(app: App, raw: string, sourcePath: string): PersonRef {
  const name = displayName(raw)
  if (!isWikilink(raw)) return { raw, name, path: null, state: 'plain' }
  const inner = /^\[\[(.+?)\]\]$/.exec(raw.trim())?.[1] ?? ''
  const linkpath = inner.split('|')[0].trim()
  const dest = linkpath ? app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath) : null
  if (!dest) return { raw, name, path: null, state: 'unresolved' }
  return { raw, name, path: dest.path, state: 'linked' }
}

/** Wikilink form regardless of the user's markdown-link preference, as property values need. */
export function personLink(app: App, file: TFile, sourcePath: string): string {
  const linktext = app.metadataCache.fileToLinktext(file, sourcePath)
  const base = file.basename
  return linktext === base ? `[[${linktext}]]` : `[[${linktext}|${base}]]`
}

/** Notes offered as people: everything in the people folder, or the whole vault when unset. */
export function personNotes(app: App, peopleFolder: string): TFile[] {
  const folder = peopleFolder.trim()
  const files = app.vault.getMarkdownFiles()
  if (!folder) return files
  const prefix = normalizePath(folder) + '/'
  return files.filter((f) => f.path.startsWith(prefix))
}

export async function createPersonNote(app: App, peopleFolder: string, name: string): Promise<TFile> {
  const folder = normalizePath(peopleFolder.trim() || 'People')
  await ensureFolder(app, folder)
  const path = normalizePath(`${folder}/${name}.md`)
  const existing = app.vault.getAbstractFileByPath(path)
  if (existing instanceof TFile) return existing
  return app.vault.create(path, '')
}

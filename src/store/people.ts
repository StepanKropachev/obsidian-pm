import { normalizePath, TFile, type App } from 'obsidian'
import { displayName } from '../utils'
import { ensureFolder, resolveVaultLink } from './vaultFs'

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

export function resolvePeople(app: App, values: string[], sourcePath: string): PersonRef[] {
  return values.map((value) => resolvePerson(app, value, sourcePath))
}

export interface PersonCandidate {
  link: string
  name: string
}

/** Person notes matching what the user typed, as link + name ready to store and show. */
export function personCandidates(
  app: App,
  peopleFolder: string,
  query: string,
  sourcePath: string,
  limit = 20
): PersonCandidate[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return personNotes(app, peopleFolder)
    .filter((file) => file.basename.toLowerCase().includes(q))
    .slice(0, limit)
    .map((file) => ({ link: personLink(app, file, sourcePath), name: file.basename }))
}

export async function createPersonLink(
  app: App,
  peopleFolder: string,
  name: string,
  sourcePath: string
): Promise<string> {
  const file = await createPersonNote(app, peopleFolder, name)
  return personLink(app, file, sourcePath)
}

/**
 * Identity for grouping and filtering: the note a value points at, or the name itself when
 * it points nowhere. Unlike `resolvePerson` a bare name is resolved here too, so a person
 * typed as text groups with the same person written as a link. Keys are read from the vault
 * root so one person keys the same no matter which task names them.
 */
export function personKey(app: App, raw: string): string {
  return resolveVaultLink(app, raw, '') ?? displayName(raw)
}

/** Caches within one pass; filtering asks for the same handful of names on every repaint. */
export function personKeyer(app: App): (raw: string) => string {
  const cache = new Map<string, string>()
  return (raw: string) => {
    const hit = cache.get(raw)
    if (hit !== undefined) return hit
    const key = personKey(app, raw)
    cache.set(raw, key)
    return key
  }
}

// NodeVaultAdapter — the real-filesystem analog of `test/fakeVault.ts`.
//
// It furnishes the `{ vault, fileManager, metadataCache }` surface `ProjectStore`
// talks to, backed by Node `fs` under a real vault root. Like `FakeVault` it
// keeps a `Map<path, TFile>` / `Map<path, TFolder>` mirror (vault-relative,
// normalized paths, exactly as Obsidian keys them), hydrated by scanning the
// vault directory on construction and mutated together with disk on every write.
// Reads hit disk; `vault.process` writes atomically (tmp-file + rename) so the
// store's reliance on `process` atomicity holds. `metadataCache.getFileCache`
// returns `null` (the store falls back to read+parse) — the MVP fidelity level.

import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TAbstractFile, TFile, TFolder, normalizePath, parseYaml } from 'obsidian'
import { appendYaml } from '../../src/store'

const expectDefined = <T>(value: T | null | undefined, message = 'expected value to be defined'): T => {
  if (value == null) throw new Error(message)
  return value
}

/** Directories never treated as vault content. */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.trash'])

export class NodeVault {
  private files = new Map<string, TFile>()
  private folders = new Map<string, TFolder>()

  constructor(readonly root: string) {
    const rootFolder = makeFolder('', null)
    this.folders.set('', rootFolder)
    this.scan('')
  }

  /** Absolute on-disk path for a vault-relative path. */
  private abs(rel: string): string {
    return rel ? join(this.root, rel) : this.root
  }

  /** Eagerly build the folder/file mirror by walking the vault directory. */
  private scan(rel: string): void {
    let entries: string[]
    try {
      entries = readdirSync(this.abs(rel))
    } catch {
      return
    }
    for (const name of entries) {
      if (rel === '' && SKIP_DIRS.has(name)) continue
      const childRel = normalizePath(rel ? `${rel}/${name}` : name)
      let isDir = false
      try {
        isDir = statSync(this.abs(childRel)).isDirectory()
      } catch {
        continue
      }
      if (isDir) {
        const parent = this.ensureFolderForPath(childRel)
        if (!this.folders.has(childRel)) {
          const folder = makeFolder(childRel, parent)
          this.folders.set(childRel, folder)
          parent.children.push(folder)
        }
        this.scan(childRel)
      } else {
        const parent = this.ensureFolderForPath(childRel)
        if (!this.files.has(childRel)) {
          const file = makeFile(childRel, parent)
          this.files.set(childRel, file)
          parent.children.push(file)
        }
      }
    }
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    const n = normalizePath(path)
    return this.files.get(n) ?? this.folders.get(n) ?? null
  }

  getMarkdownFiles(): TFile[] {
    const out: TFile[] = []
    for (const file of this.files.values()) {
      if (file.extension === 'md') out.push(file)
    }
    return out
  }

  async cachedRead(file: TFile): Promise<string> {
    try {
      return await readFile(this.abs(file.path), 'utf8')
    } catch {
      return ''
    }
  }

  async read(file: TFile): Promise<string> {
    return this.cachedRead(file)
  }

  async modify(file: TFile, content: string): Promise<void> {
    if (!this.files.has(file.path)) throw new Error(`modify: ${file.path} does not exist`)
    this.writeAtomic(file.path, content)
  }

  async process(file: TFile, fn: (data: string) => string): Promise<string> {
    if (!this.files.has(file.path)) throw new Error(`process: ${file.path} does not exist`)
    const current = await this.cachedRead(file)
    const next = fn(current)
    this.writeAtomic(file.path, next)
    return next
  }

  async create(path: string, content: string): Promise<TFile> {
    const n = normalizePath(path)
    if (this.files.has(n)) throw new Error(`create: ${n} already exists`)
    const parent = this.ensureFolderOnDisk(n)
    this.writeAtomic(n, content)
    const file = makeFile(n, parent)
    this.files.set(n, file)
    parent.children.push(file)
    return file
  }

  async createBinary(path: string, data: ArrayBuffer): Promise<TFile> {
    const n = normalizePath(path)
    if (this.files.has(n)) throw new Error(`createBinary: ${n} already exists`)
    const parent = this.ensureFolderOnDisk(n)
    writeFileSync(this.abs(n), Buffer.from(data))
    const file = makeFile(n, parent)
    this.files.set(n, file)
    parent.children.push(file)
    return file
  }

  async createFolder(path: string): Promise<void> {
    const n = normalizePath(path)
    if (this.folders.has(n)) throw new Error('Folder already exists')
    mkdirSync(this.abs(n), { recursive: true })
    this.registerFolderChain(n)
  }

  async rename(file: TAbstractFile, newPath: string): Promise<void> {
    const to = normalizePath(newPath)
    const from = file.path
    if (this.getAbstractFileByPath(to)) throw new Error(`rename: ${to} already exists`)
    this.ensureFolderOnDisk(to)
    renameSync(this.abs(from), this.abs(to))
    if (file instanceof TFolder) {
      this.rekeyFolder(file, from, to)
      return
    }
    const entry = this.files.get(from)
    if (!entry) throw new Error(`rename: ${from} does not exist`)
    this.files.delete(from)
    detachFromParent(entry)
    const parent = this.ensureFolderForPath(to)
    relocateFile(entry, to, parent)
    this.files.set(to, entry)
    parent.children.push(entry)
  }

  async trashFile(file: TAbstractFile): Promise<void> {
    // Reversible delete: move under `<vault>/.trash/` (never `unlink`).
    const trashRel = normalizePath(`.trash/${file.name}`)
    const trashAbs = this.abs(trashRel)
    mkdirSync(this.abs('.trash'), { recursive: true })
    let dest = trashAbs
    let n = 1
    while (existsSync(dest)) dest = `${trashAbs}.${n++}`
    renameSync(this.abs(file.path), dest)
    this.forgetSubtree(file)
  }

  on(): { unload: () => void } {
    // The store only consumes `vault.on` via `registerCacheInvalidation`, which
    // the one-shot CLI never calls. A no-op EventRef stand-in suffices.
    return { unload: () => {} }
  }

  // ─── mirror helpers ─────────────────────────────────────────────────────────

  private writeAtomic(rel: string, content: string): void {
    const abs = this.abs(rel)
    const tmp = `${abs}.pm-${process.pid}-${Date.now()}.tmp`
    writeFileSync(tmp, content)
    renameSync(tmp, abs)
  }

  /** Ensure a path's parent folder chain exists in the mirror only (no disk). */
  private ensureFolderForPath(path: string): TFolder {
    const idx = path.lastIndexOf('/')
    if (idx < 0) return expectDefined(this.folders.get(''))
    const parentPath = path.slice(0, idx)
    const existing = this.folders.get(parentPath)
    if (existing) return existing
    const grandParent = this.ensureFolderForPath(parentPath)
    const folder = makeFolder(parentPath, grandParent)
    this.folders.set(parentPath, folder)
    grandParent.children.push(folder)
    return folder
  }

  /** Ensure a path's parent folder chain exists on disk AND in the mirror. */
  private ensureFolderOnDisk(path: string): TFolder {
    const idx = path.lastIndexOf('/')
    if (idx < 0) return expectDefined(this.folders.get(''))
    const parentPath = path.slice(0, idx)
    mkdirSync(this.abs(parentPath), { recursive: true })
    return this.registerFolderChain(parentPath)
  }

  /** Register a folder path (and any missing ancestors) in the mirror. */
  private registerFolderChain(path: string): TFolder {
    const existing = this.folders.get(path)
    if (existing) return existing
    const parent = this.ensureFolderForPath(path)
    const folder = makeFolder(path, parent)
    this.folders.set(path, folder)
    parent.children.push(folder)
    return folder
  }

  /** Re-key a moved folder subtree in the mirror (ports FakeVault.rename). */
  private rekeyFolder(file: TFolder, from: string, to: string): void {
    const folders = [file, ...[...this.folders.values()].filter((f) => f.path.startsWith(from + '/'))]
    const entries = [...this.files.values()].filter((e) => e.path.startsWith(from + '/'))
    for (const f of folders) this.folders.delete(f.path)
    for (const e of entries) this.files.delete(e.path)
    detachFromParent(file)
    for (const f of folders) f.children = []
    folders.sort((a, b) => a.path.length - b.path.length)
    for (const f of folders) {
      const np = to + f.path.slice(from.length)
      const parent = this.ensureFolderForPath(np)
      f.path = np
      f.name = np.slice(np.lastIndexOf('/') + 1)
      f.parent = parent
      this.folders.set(np, f)
      parent.children.push(f)
    }
    for (const e of entries) {
      const np = to + e.path.slice(from.length)
      const parent = this.ensureFolderForPath(np)
      relocateFile(e, np, parent)
      this.files.set(np, e)
      parent.children.push(e)
    }
  }

  /** Drop a file/folder subtree from the mirror. */
  private forgetSubtree(file: TAbstractFile): void {
    if (file instanceof TFolder) {
      const folders = [file, ...[...this.folders.values()].filter((f) => f.path.startsWith(file.path + '/'))]
      const entries = [...this.files.values()].filter((e) => e.path.startsWith(file.path + '/'))
      for (const f of folders) this.folders.delete(f.path)
      for (const e of entries) this.files.delete(e.path)
      detachFromParent(file)
      return
    }
    this.files.delete(file.path)
    detachFromParent(file)
  }
}

export interface NodeApp {
  vault: NodeVault
  fileManager: {
    trashFile: (file: TAbstractFile) => Promise<void>
    renameFile: (file: TAbstractFile, newPath: string) => Promise<void>
    processFrontMatter: (file: TFile, fn: (fm: Record<string, unknown>) => void) => Promise<void>
  }
  metadataCache: { getFileCache: (file: TFile) => { frontmatter?: Record<string, unknown> } | null }
}

/** Build the real-fs `App`-like the store is constructed against. */
export function makeNodeApp(root: string): { app: NodeApp; vault: NodeVault } {
  const vault = new NodeVault(root)
  const app: NodeApp = {
    vault,
    fileManager: {
      trashFile: (file) => vault.trashFile(file),
      renameFile: (file, newPath) => vault.rename(file, newPath),
      processFrontMatter: async (file, fn): Promise<void> => {
        await vault.process(file, (content) => {
          const { frontmatter, body } = splitFrontmatter(content)
          const fm = frontmatter ?? {}
          fn(fm)
          const lines: string[] = ['---']
          appendYaml(lines, fm, 0)
          lines.push('---', '', body)
          return lines.join('\n')
        })
      }
    },
    // MVP: always miss → the store reads + parses the file itself.
    metadataCache: {
      getFileCache: () => null
    }
  }
  return { app, vault }
}

function splitFrontmatter(content: string): { frontmatter: Record<string, unknown> | null; body: string } {
  if (!content.startsWith('---')) return { frontmatter: null, body: content }
  const end = content.indexOf('\n---', 4)
  if (end === -1) return { frontmatter: null, body: content }
  const raw = content.slice(4, end)
  const body = content.slice(end + 4).replace(/^\n+/, '')
  try {
    // Reuse the same YAML parser the store uses via the shim.
    return { frontmatter: (parseYaml(raw) as Record<string, unknown>) ?? {}, body }
  } catch {
    return { frontmatter: null, body: content }
  }
}

function makeFile(path: string, parent: TFolder): TFile {
  const f = new TFile()
  relocateFile(f, path, parent)
  return f
}

function relocateFile(f: TFile, path: string, parent: TFolder): void {
  f.path = path
  const slash = path.lastIndexOf('/')
  const name = slash >= 0 ? path.slice(slash + 1) : path
  f.name = name
  const dot = name.lastIndexOf('.')
  f.basename = dot > 0 ? name.slice(0, dot) : name
  f.extension = dot > 0 ? name.slice(dot + 1) : ''
  f.parent = parent
}

function makeFolder(path: string, parent: TFolder | null): TFolder {
  const f = new TFolder()
  f.path = path
  const slash = path.lastIndexOf('/')
  f.name = slash >= 0 ? path.slice(slash + 1) : path
  f.parent = parent
  f.children = []
  return f
}

function detachFromParent(file: TAbstractFile): void {
  if (!file.parent) return
  const arr = file.parent.children
  const idx = arr.indexOf(file)
  if (idx >= 0) arr.splice(idx, 1)
}

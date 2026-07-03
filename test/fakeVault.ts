import { TAbstractFile, TFile, TFolder, normalizePath, parseYaml } from 'obsidian'
import { appendYaml } from '../src/store/YamlParser'

const expectDefined = <T>(value: T | null | undefined, message = 'expected value to be defined'): T => {
  if (value == null) throw new Error(message)
  return value
}

interface FileContent {
  file: TFile
  content: string
}

export class FakeVault {
  private files = new Map<string, FileContent>()
  private folders = new Map<string, TFolder>()

  modifyCount = new Map<string, number>()
  createCount = new Map<string, number>()
  trashCount = new Map<string, number>()

  constructor() {
    const root = makeFolder('', null)
    this.folders.set('', root)
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    const n = normalizePath(path)
    return this.files.get(n)?.file ?? this.folders.get(n) ?? null
  }

  async cachedRead(file: TFile): Promise<string> {
    return this.files.get(file.path)?.content ?? ''
  }

  async read(file: TFile): Promise<string> {
    return this.cachedRead(file)
  }

  async modify(file: TFile, content: string): Promise<void> {
    const entry = this.files.get(file.path)
    if (!entry) throw new Error(`modify: ${file.path} does not exist`)
    entry.content = content
    bump(this.modifyCount, file.path)
  }

  async process(file: TFile, fn: (data: string) => string): Promise<string> {
    const entry = this.files.get(file.path)
    if (!entry) throw new Error(`process: ${file.path} does not exist`)
    const next = fn(entry.content)
    entry.content = next
    bump(this.modifyCount, file.path)
    return next
  }

  async create(path: string, content: string): Promise<TFile> {
    const n = normalizePath(path)
    if (this.files.has(n)) throw new Error(`create: ${n} already exists`)
    const parent = this.ensureFolderForPath(n)
    const file = makeFile(n, parent)
    this.files.set(n, { file, content })
    parent.children.push(file)
    bump(this.createCount, n)
    return file
  }

  async createBinary(path: string, _data: ArrayBuffer): Promise<TFile> {
    const n = normalizePath(path)
    if (this.files.has(n)) throw new Error(`createBinary: ${n} already exists`)
    const parent = this.ensureFolderForPath(n)
    const file = makeFile(n, parent)
    this.files.set(n, { file, content: '' })
    parent.children.push(file)
    bump(this.createCount, n)
    return file
  }

  async createFolder(path: string): Promise<void> {
    const n = normalizePath(path)
    if (this.folders.has(n)) throw new Error('Folder already exists')
    const parent = this.ensureFolderForPath(n)
    const folder = makeFolder(n, parent)
    this.folders.set(n, folder)
    parent.children.push(folder)
  }

  async rename(file: TAbstractFile, newPath: string): Promise<void> {
    const to = normalizePath(newPath)
    const from = file.path
    if (this.getAbstractFileByPath(to)) throw new Error(`rename: ${to} already exists`)
    if (file instanceof TFolder) {
      const folders = [file, ...[...this.folders.values()].filter((f) => f.path.startsWith(from + '/'))]
      const entries = [...this.files.values()].filter((e) => e.file.path.startsWith(from + '/'))
      for (const f of folders) this.folders.delete(f.path)
      for (const e of entries) this.files.delete(e.file.path)
      detachFromParent(file)
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
        const np = to + e.file.path.slice(from.length)
        const parent = this.ensureFolderForPath(np)
        relocateFile(e.file, np, parent)
        this.files.set(np, e)
        parent.children.push(e.file)
      }
      return
    }
    const entry = this.files.get(from)
    if (!entry) throw new Error(`rename: ${from} does not exist`)
    this.files.delete(from)
    detachFromParent(entry.file)
    const parent = this.ensureFolderForPath(to)
    relocateFile(entry.file, to, parent)
    this.files.set(to, entry)
    parent.children.push(entry.file)
  }

  async trashFile(file: TAbstractFile): Promise<void> {
    if (file instanceof TFolder) {
      for (const child of file.children.slice()) await this.trashFile(child)
      this.folders.delete(file.path)
      detachFromParent(file)
      bump(this.trashCount, file.path)
      return
    }
    const entry = this.files.get(file.path)
    if (!entry) return
    this.files.delete(file.path)
    detachFromParent(entry.file)
    bump(this.trashCount, file.path)
  }

  resetCounts(): void {
    this.modifyCount.clear()
    this.createCount.clear()
    this.trashCount.clear()
  }

  private ensureFolderForPath(path: string): TFolder {
    const idx = path.lastIndexOf('/')
    if (idx < 0) return expectDefined(this.folders.get(''))
    const parentPath = path.slice(0, idx)
    const existing = this.folders.get(parentPath)
    if (existing) return existing
    // Create parent chain recursively.
    const grandParent = this.ensureFolderForPath(parentPath)
    const folder = makeFolder(parentPath, grandParent)
    this.folders.set(parentPath, folder)
    grandParent.children.push(folder)
    return folder
  }
}

export function makeFakeApp(): { app: FakeAppLike; vault: FakeVault } {
  const vault = new FakeVault()
  const app: FakeAppLike = {
    vault,
    fileManager: {
      trashFile: (file: TAbstractFile) => vault.trashFile(file),
      renameFile: (file: TAbstractFile, newPath: string) => vault.rename(file, newPath),
      processFrontMatter: async (file: TFile, fn: (fm: Record<string, unknown>) => void): Promise<void> => {
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
    // Minimal metadataCache: always misses, forcing the store's fallback read+parse path.
    // Tests that want to exercise the cache hit can override this per-test.
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
    return { frontmatter: parseYaml(raw) as Record<string, unknown>, body }
  } catch {
    return { frontmatter: null, body: content }
  }
}

export interface FakeAppLike {
  vault: FakeVault
  fileManager: {
    trashFile: (file: TAbstractFile) => Promise<void>
    renameFile: (file: TAbstractFile, newPath: string) => Promise<void>
    processFrontMatter: (file: TFile, fn: (fm: Record<string, unknown>) => void) => Promise<void>
  }
  metadataCache: { getFileCache: (file: TFile) => { frontmatter?: Record<string, unknown> } | null }
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

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

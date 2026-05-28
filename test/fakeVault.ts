import { TAbstractFile, TFile, TFolder, normalizePath } from 'obsidian'

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

  async createFolder(path: string): Promise<void> {
    const n = normalizePath(path)
    if (this.folders.has(n)) throw new Error('Folder already exists')
    const parent = this.ensureFolderForPath(n)
    const folder = makeFolder(n, parent)
    this.folders.set(n, folder)
    parent.children.push(folder)
  }

  async trashFile(file: TFile): Promise<void> {
    const entry = this.files.get(file.path)
    if (!entry) return
    this.files.delete(file.path)
    if (entry.file.parent) {
      const arr = entry.file.parent.children
      const idx = arr.indexOf(entry.file)
      if (idx >= 0) arr.splice(idx, 1)
    }
    bump(this.trashCount, file.path)
  }

  resetCounts(): void {
    this.modifyCount.clear()
    this.createCount.clear()
    this.trashCount.clear()
  }

  private ensureFolderForPath(path: string): TFolder {
    const idx = path.lastIndexOf('/')
    if (idx < 0) return this.folders.get('')!
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
      trashFile: (file: TFile) => vault.trashFile(file)
    }
  }
  return { app, vault }
}

export interface FakeAppLike {
  vault: FakeVault
  fileManager: { trashFile: (file: TFile) => Promise<void> }
}

function makeFile(path: string, parent: TFolder): TFile {
  const f = new TFile()
  f.path = path
  const slash = path.lastIndexOf('/')
  const name = slash >= 0 ? path.slice(slash + 1) : path
  f.name = name
  const dot = name.lastIndexOf('.')
  f.basename = dot > 0 ? name.slice(0, dot) : name
  f.extension = dot > 0 ? name.slice(dot + 1) : ''
  f.parent = parent
  return f
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

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

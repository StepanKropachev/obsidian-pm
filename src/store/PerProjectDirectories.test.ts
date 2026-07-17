import type { App } from 'obsidian'
import { TFile, TFolder } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../test/fakeVault'
import { DEFAULT_SETTINGS, makeTask, type PMSettings } from '../types'
import { ProjectStore } from './ProjectStore'
import { parseFrontmatter } from './YamlParser'

const SETTINGS: PMSettings = { ...DEFAULT_SETTINGS }

function newStore(): { store: ProjectStore; vault: FakeVault; app: App } {
  const { app, vault } = makeFakeApp()
  const store = new ProjectStore(app as unknown as App, () => SETTINGS)
  return { store, vault, app: app as unknown as App }
}

function fileAt(vault: FakeVault, path: string): TFile {
  const f = vault.getAbstractFileByPath(path)
  if (!(f instanceof TFile)) throw new Error(`expected a file at ${path}`)
  return f
}

async function frontmatterOf(vault: FakeVault, path: string): Promise<Record<string, unknown>> {
  const content = await vault.cachedRead(fileAt(vault, path))
  return parseFrontmatter(content).frontmatter ?? {}
}

describe('per-project directories — path frontmatter', () => {
  it('persists the create directory as `path`, including nested category folders', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Q3 Launch', 'Projects/Income/2026')
    const fm = await frontmatterOf(vault, project.filePath)
    expect(fm.path).toBe('Projects/Income/2026')
    expect(project.filePath).toBe('Projects/Income/2026/Q3 Launch/Q3 Launch.md')
    // Task folder is co-located under the same directory, inside the per-project folder.
    expect(vault.getAbstractFileByPath('Projects/Income/2026/Q3 Launch/Q3 Launch_tasks')).not.toBeNull()
  })

  it('reload preserves `path` through the YAML round-trip', async () => {
    const { store, vault, app } = newStore()
    const created = await store.createProject('Rollout', 'Clients/Acme')
    const store2 = new ProjectStore(app, () => SETTINGS)
    const reloaded = await store2.loadProject(fileAt(vault, created.filePath))
    expect(reloaded?.path).toBe('Clients/Acme')
  })
})

describe('per-project directories — projectDirectory resolution', () => {
  it('returns the declared `path` when present', async () => {
    const { store } = newStore()
    const project = await store.createProject('Ops', 'Areas/Ops')
    expect(store.projectDirectory(project)).toBe('Areas/Ops')
  })

  it('falls back to the file parent folder when `path` is absent (legacy)', async () => {
    const { store, vault } = newStore()
    await vault.create(
      'Projects/Legacy.md',
      ['---', 'pm-project: true', 'id: legacy-1', 'title: Legacy', 'taskIds: []', '---', '', 'body'].join('\n')
    )
    const project = await store.loadProject(fileAt(vault, 'Projects/Legacy.md'))
    expect(project).not.toBeNull()
    if (!project) return
    expect(project.path).toBeUndefined()
    expect(store.projectDirectory(project)).toBe('Projects')
  })

  it('falls back for a blank `path` string too', async () => {
    const { store, vault } = newStore()
    await vault.create(
      'Nested/Here/Blank.md',
      ['---', 'pm-project: true', 'id: blank-1', 'title: Blank', 'path: ""', 'taskIds: []', '---', ''].join('\n')
    )
    const project = await store.loadProject(fileAt(vault, 'Nested/Here/Blank.md'))
    expect(project).not.toBeNull()
    if (!project) return
    expect(store.projectDirectory(project)).toBe('Nested/Here')
  })
})

describe('per-project directories — vault-wide discovery', () => {
  it('finds projects anywhere in the vault, not just the default folder', async () => {
    const { store } = newStore()
    await store.createProject('In Default', 'Projects')
    await store.createProject('Off Grid', 'Random/Deep/Place')

    const found = await store.discoverProjects()
    const paths = found.map((p) => p.filePath)
    expect(paths).toContain('Projects/In Default/In Default.md')
    expect(paths).toContain('Random/Deep/Place/Off Grid/Off Grid.md')
  })

  it('discovers two same-named projects in different folders as distinct entries', async () => {
    const { store } = newStore()
    await store.createProject('Roadmap', 'Areas/Income')
    await store.createProject('Roadmap', 'Areas/Community')

    const found = await store.discoverProjects()
    const roadmaps = found.filter((p) => p.title === 'Roadmap')
    expect(roadmaps.map((p) => p.filePath).sort()).toEqual([
      'Areas/Community/Roadmap/Roadmap.md',
      'Areas/Income/Roadmap/Roadmap.md'
    ])
    expect(roadmaps.map((p) => store.projectDirectory(p)).sort()).toEqual(['Areas/Community', 'Areas/Income'])
  })

  it('ignores non-project markdown files', async () => {
    const { store, vault } = newStore()
    await store.createProject('Real', 'Projects')
    await vault.create('Notes/Plain.md', ['---', 'title: just a note', '---', '', 'nothing here'].join('\n'))
    await vault.create('Notes/Task.md', ['---', 'pm-task: true', 'title: loose task', '---', ''].join('\n'))

    const found = await store.discoverProjects()
    expect(found.map((p) => p.filePath)).toEqual(['Projects/Real/Real.md'])
  })

  it('loadAllProjects delegates to vault-wide discovery', async () => {
    const { store } = newStore()
    await store.createProject('Anywhere', 'Somewhere/Else')
    const found = await store.loadAllProjects('Projects')
    expect(found.some((p) => p.filePath === 'Somewhere/Else/Anywhere/Anywhere.md')).toBe(true)
  })
})

describe('per-project directories — moveProject (editable folder path)', () => {
  it('creates intermediate folders when moving into a deep dir that does not exist yet', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Deep', 'Projects')
    await store.insertTask(project, makeTask({ title: 'inner' }))

    await store.moveProject(project, 'A/B/C/D')

    expect(vault.getAbstractFileByPath('A/B/C/D/Deep/Deep.md')).toBeInstanceOf(TFile)
    expect(vault.getAbstractFileByPath('A/B/C/D/Deep/Deep_tasks')).toBeInstanceOf(TFolder)
    expect(vault.getAbstractFileByPath('Projects/Deep/Deep.md')).toBeNull()
    expect(store.projectDirectory(project)).toBe('A/B/C/D')
    expect(project.tasks[0]?.filePath?.startsWith('A/B/C/D/Deep/Deep_tasks/')).toBe(true)
  })

  it('is a no-op when the destination equals the current directory', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Steady', 'Projects')
    await store.insertTask(project, makeTask({ title: 'x' }))
    const beforeFilePath = project.filePath
    const beforeTaskPath = project.tasks[0]?.filePath

    await store.moveProject(project, 'Projects')

    expect(project.filePath).toBe(beforeFilePath)
    expect(project.tasks[0]?.filePath).toBe(beforeTaskPath)
    expect(vault.getAbstractFileByPath('Projects/Steady/Steady.md')).toBeInstanceOf(TFile)
  })

  it('throws (without overwriting) when the destination .md is already occupied', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Clash', 'Projects')
    // Pre-existing content occupies the target per-project folder `Areas/Clash`.
    await vault.create('Areas/Clash/Clash.md', ['---', 'title: squatter', '---', '', 'do not touch'].join('\n'))

    await expect(store.moveProject(project, 'Areas')).rejects.toThrow(/already exists/i)

    // Nothing moved; the squatter is intact, the project stays put.
    expect(vault.getAbstractFileByPath('Projects/Clash/Clash.md')).toBeInstanceOf(TFile)
    const squatter = await vault.cachedRead(fileAt(vault, 'Areas/Clash/Clash.md'))
    expect(squatter).toContain('do not touch')
    expect(store.projectDirectory(project)).toBe('Projects')
  })

  it('carries archived tasks and per-task attachments along with the move', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Portfolio', 'Projects')
    const archived = makeTask({ title: 'done thing' })
    await store.insertTask(project, archived)
    // Drop an attachment beside the task, then archive it.
    const attachmentDir = 'Projects/Portfolio/Portfolio_tasks/' + archived.id + '/attachments'
    await vault.createFolder(attachmentDir)
    await vault.create(attachmentDir + '/spec.txt', 'attachment body')
    await store.archiveTask(project, archived.id)
    expect(project.tasks[0]?.archived).toBe(true)

    await store.moveProject(project, 'Areas/Archive Home')

    // Archived file, its Archive subfolder, and the attachment all relocated.
    expect(vault.getAbstractFileByPath('Areas/Archive Home/Portfolio/Portfolio_tasks/Archive')).toBeInstanceOf(TFolder)
    const movedTaskPath = project.tasks[0]?.filePath ?? ''
    expect(movedTaskPath.startsWith('Areas/Archive Home/Portfolio/Portfolio_tasks/Archive/')).toBe(true)
    expect(vault.getAbstractFileByPath(movedTaskPath)).toBeInstanceOf(TFile)
    expect(
      vault.getAbstractFileByPath(
        'Areas/Archive Home/Portfolio/Portfolio_tasks/' + archived.id + '/attachments/spec.txt'
      )
    ).toBeInstanceOf(TFile)
    expect(vault.getAbstractFileByPath('Projects/Portfolio/Portfolio_tasks')).toBeNull()
  })

  it('honors spaces and unicode in the destination path literally', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Café Plan', 'Projects')
    await store.insertTask(project, makeTask({ title: 'crème' }))
    const spacedDir = 'Zonă/Proiecte Café'

    await store.moveProject(project, spacedDir)

    expect(vault.getAbstractFileByPath(`${spacedDir}/Café Plan/Café Plan.md`)).toBeInstanceOf(TFile)
    expect(vault.getAbstractFileByPath(`${spacedDir}/Café Plan/Café Plan_tasks`)).toBeInstanceOf(TFolder)
    expect(project.filePath).toBe(`${spacedDir}/Café Plan/Café Plan.md`)
    const fm = await frontmatterOf(vault, project.filePath)
    expect(fm.path).toBe(spacedDir)
  })

  it('self-marks moved paths so the vault rename events do not echo', async () => {
    const { store } = newStore()
    const project = await store.createProject('Echoless', 'Projects')
    await store.moveProject(project, 'Areas/Quiet')
    // Mirrors renameProject's discipline: old + new nested note paths are consumable.
    expect(store.consumeSelfWrite('Areas/Quiet/Echoless/Echoless.md')).toBe(true)
    expect(store.consumeSelfWrite('Projects/Echoless/Echoless.md')).toBe(true)
  })
})

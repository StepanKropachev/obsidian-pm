import type { App } from 'obsidian'
import { TFile, TFolder } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../test/fakeVault'
import { DEFAULT_SETTINGS, makeTask, type PMSettings } from '../types'
import { ProjectStore } from './ProjectStore'
import { flattenTasks } from './TaskTreeOps'
import { parseFrontmatter } from './YamlParser'

const SETTINGS: PMSettings = { ...DEFAULT_SETTINGS }

function newStore(): { store: ProjectStore; vault: FakeVault } {
  const { app, vault } = makeFakeApp()
  const store = new ProjectStore(app as unknown as App, () => SETTINGS)
  return { store, vault }
}

function fileAt(vault: FakeVault, path: string): TFile {
  const f = vault.getAbstractFileByPath(path)
  if (!(f instanceof TFile)) throw new Error(`expected a file at ${path}`)
  return f
}

async function fmOf(vault: FakeVault, path: string): Promise<Record<string, unknown>> {
  return parseFrontmatter(await vault.cachedRead(fileAt(vault, path))).frontmatter ?? {}
}

// ─── Outbound: renameProject ────────────────────────────────────────────────

describe('ProjectStore.renameProject (outbound)', () => {
  it('renames the project .md and its _tasks folder, keeping tasks attached', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Gamma', 'Projects')
    await store.insertTask(project, makeTask({ title: 'child' }))

    await store.renameProject(project, 'Delta')

    // INT-020 nested layout: the per-project folder, the note, and the tasks folder all rename.
    expect(vault.getAbstractFileByPath('Projects/Delta/Delta.md')).toBeInstanceOf(TFile)
    expect(vault.getAbstractFileByPath('Projects/Gamma/Gamma.md')).toBeNull()
    expect(vault.getAbstractFileByPath('Projects/Delta/Delta_tasks')).toBeInstanceOf(TFolder)
    expect(vault.getAbstractFileByPath('Projects/Gamma/Gamma_tasks')).toBeNull()

    // Memory rebound: identity, title, and the task's filePath follow the folder.
    expect(project.filePath).toBe('Projects/Delta/Delta.md')
    expect(project.title).toBe('Delta')
    expect(project.tasks).toHaveLength(1)
    expect(project.tasks[0].filePath?.startsWith('Projects/Delta/Delta_tasks/')).toBe(true)
    // The moved task file exists at its new location.
    expect(vault.getAbstractFileByPath(project.tasks[0].filePath ?? '')).toBeInstanceOf(TFile)
  })

  it('persists the new title into the project frontmatter', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Gamma', 'Projects')
    await store.renameProject(project, 'Delta')
    const fm = await fmOf(vault, 'Projects/Delta/Delta.md')
    expect(fm.title).toBe('Delta')
  })

  it('self-marks both old and new project paths so the rename event does not echo', async () => {
    const { store } = newStore()
    const project = await store.createProject('Iota', 'Projects')
    await store.renameProject(project, 'Kappa')
    expect(store.consumeSelfWrite('Projects/Kappa/Kappa.md')).toBe(true)
    expect(store.consumeSelfWrite('Projects/Iota/Iota.md')).toBe(true)
  })

  it('throws when the target name is already taken and leaves the project unchanged', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Src', 'Projects')
    await store.createProject('Dst', 'Projects')

    await expect(store.renameProject(project, 'Dst')).rejects.toThrow(/already exists/)
    expect(project.filePath).toBe('Projects/Src/Src.md')
    expect(vault.getAbstractFileByPath('Projects/Src/Src.md')).toBeInstanceOf(TFile)
  })
})

// ─── Inbound: handleExternalRename ──────────────────────────────────────────

describe('ProjectStore.handleExternalRename (inbound)', () => {
  it('updates the loaded project title from an external .md rename', async () => {
    const { store, vault } = newStore()
    const created = await store.createProject('Alpha', 'Projects')
    const project = await store.loadProject(fileAt(vault, created.filePath))
    expect(project).not.toBeNull()
    if (!project) return

    // INT-020 nested layout: the note is renamed in place inside its per-project folder.
    await vault.rename(fileAt(vault, 'Projects/Alpha/Alpha.md'), 'Projects/Alpha/Beta.md')
    await store.handleExternalRename('Projects/Alpha/Alpha.md', fileAt(vault, 'Projects/Alpha/Beta.md'))

    expect(project.title).toBe('Beta')
    expect(project.filePath).toBe('Projects/Alpha/Beta.md')
    // Persisted title is in sync too.
    expect((await fmOf(vault, 'Projects/Alpha/Beta.md')).title).toBe('Beta')
  })

  it('cascades the _tasks folder rename so tasks stay attached', async () => {
    const { store, vault } = newStore()
    const created = await store.createProject('Eta', 'Projects')
    const project = await store.loadProject(fileAt(vault, created.filePath))
    if (!project) throw new Error('project failed to load')
    await store.insertTask(project, makeTask({ title: 'attached' }))

    // Only the note .md is renamed externally (in place, inside its per-project
    // folder); the tasks folder still carries the old name and must cascade.
    await vault.rename(fileAt(vault, 'Projects/Eta/Eta.md'), 'Projects/Eta/Theta.md')
    await store.handleExternalRename('Projects/Eta/Eta.md', fileAt(vault, 'Projects/Eta/Theta.md'))

    expect(project.tasks).toHaveLength(1)
    expect(project.tasks[0].filePath?.startsWith('Projects/Eta/Theta_tasks/')).toBe(true)
    expect(vault.getAbstractFileByPath('Projects/Eta/Theta_tasks')).toBeInstanceOf(TFolder)
    expect(vault.getAbstractFileByPath('Projects/Eta/Eta_tasks')).toBeNull()
  })

  it('ignores the echo of a plugin-initiated rename (self-marked new path)', async () => {
    const { store, vault } = newStore()
    const project = await store.createProject('Mu', 'Projects')
    // renameProject self-marks Nu.md; simulate the resulting vault event arriving.
    await store.renameProject(project, 'Nu')
    // The store now tracks the project at Nu.md; a second (echo) call must no-op.
    const titleBefore = project.title
    await store.handleExternalRename('Projects/Mu/Mu.md', fileAt(vault, 'Projects/Nu/Nu.md'))
    expect(project.title).toBe(titleBefore)
    expect(project.filePath).toBe('Projects/Nu/Nu.md')
  })

  it('is a no-op when the old path resolves to no loaded item', async () => {
    const { store, vault } = newStore()
    await vault.create('Projects/Ghost.md', '---\npm-project: true\nid: g1\ntitle: Ghost\ntaskIds: []\n---\n')
    await vault.rename(fileAt(vault, 'Projects/Ghost.md'), 'Projects/Wraith.md')
    // Never loaded → nothing in memory to touch; must not throw.
    await expect(
      store.handleExternalRename('Projects/Ghost.md', fileAt(vault, 'Projects/Wraith.md'))
    ).resolves.toBeUndefined()
  })

  it('updates path frontmatter and moves the _tasks folder when the project moves directories', async () => {
    const { store, vault } = newStore()
    const created = await store.createProject('Move', 'Projects')
    const project = await store.loadProject(fileAt(vault, created.filePath))
    if (!project) throw new Error('project failed to load')
    await store.insertTask(project, makeTask({ title: 'kid' }))

    // INT-020: the whole nested note moves to a new filed-under directory.
    await vault.rename(fileAt(vault, 'Projects/Move/Move.md'), 'Areas/Ops/Move/Move.md')
    await store.handleExternalRename('Projects/Move/Move.md', fileAt(vault, 'Areas/Ops/Move/Move.md'))

    expect(project.filePath).toBe('Areas/Ops/Move/Move.md')
    expect(project.path).toBe('Areas/Ops')
    expect((await fmOf(vault, 'Areas/Ops/Move/Move.md')).path).toBe('Areas/Ops')
    expect(vault.getAbstractFileByPath('Areas/Ops/Move/Move_tasks')).toBeInstanceOf(TFolder)
    expect(project.tasks[0].filePath?.startsWith('Areas/Ops/Move/Move_tasks/')).toBe(true)
  })

  it('rebinds a renamed task file (filePath + title)', async () => {
    const { store, vault } = newStore()
    const created = await store.createProject('Tsk', 'Projects')
    const project = await store.loadProject(fileAt(vault, created.filePath))
    if (!project) throw new Error('project failed to load')
    const task = makeTask({ title: 'Old name' })
    await store.insertTask(project, task)
    const oldTaskPath = project.tasks[0].filePath ?? ''
    expect(oldTaskPath).not.toBe('')

    const newTaskPath = 'Projects/Tsk/Tsk_tasks/renamed.md'
    await vault.rename(fileAt(vault, oldTaskPath), newTaskPath)
    await store.handleExternalRename(oldTaskPath, fileAt(vault, newTaskPath))

    expect(project.tasks[0].filePath).toBe(newTaskPath)
    expect(project.tasks[0].title).toBe('renamed')
    expect((await fmOf(vault, newTaskPath)).title).toBe('renamed')
  })

  it('flags a task moved into Archive/ as archived on rename', async () => {
    const { store, vault } = newStore()
    const created = await store.createProject('Arc', 'Projects')
    const project = await store.loadProject(fileAt(vault, created.filePath))
    if (!project) throw new Error('project failed to load')
    await store.insertTask(project, makeTask({ title: 'live' }))
    const oldTaskPath = project.tasks[0].filePath ?? ''

    await store.ensureFolder('Projects/Arc/Arc_tasks/Archive')
    const archivedPath = 'Projects/Arc/Arc_tasks/Archive/live.md'
    await vault.rename(fileAt(vault, oldTaskPath), archivedPath)
    await store.handleExternalRename(oldTaskPath, fileAt(vault, archivedPath))

    expect(project.tasks[0].filePath).toBe(archivedPath)
    expect(project.tasks[0].archived).toBe(true)
  })
})

// ─── handleExternalTaskChange (live ingestion seam) ─────────────────────────

describe('ProjectStore.handleExternalTaskChange', () => {
  it('ingests a qualifying external pm-task file under a loaded project', async () => {
    const { store, vault } = newStore()
    const project = await store.loadProject(fileAt(vault, (await store.createProject('Inbox', 'Projects')).filePath))
    if (!project) throw new Error('project failed to load')

    const path = 'Projects/Inbox/Inbox_tasks/dropped.md'
    await vault.create(path, '---\npm-task: true\ntitle: Dropped in\n---\n\nbody')
    const task = await store.handleExternalTaskChange(fileAt(vault, path))

    expect(task).not.toBeNull()
    expect(flattenTasks(project.tasks).some((f) => f.task.id === task?.id)).toBe(true)
  })

  it('skips the store’s own writes (self-write) so backfills do not echo', async () => {
    const { store, vault } = newStore()
    const project = await store.loadProject(fileAt(vault, (await store.createProject('Echo', 'Projects')).filePath))
    if (!project) throw new Error('project failed to load')
    await store.insertTask(project, makeTask({ title: 'self' }))
    const taskPath = project.tasks[0].filePath ?? ''

    // insertTask self-marked taskPath; simulating the modify event must be ignored.
    const before = project.tasks.length
    const result = await store.handleExternalTaskChange(fileAt(vault, taskPath))
    expect(result).toBeNull()
    expect(project.tasks.length).toBe(before)
  })

  it('ignores files outside every loaded project folder', async () => {
    const { store, vault } = newStore()
    await store.loadProject(fileAt(vault, (await store.createProject('Scope', 'Projects')).filePath))
    await vault.create('Elsewhere/loose.md', '---\npm-task: true\ntitle: Loose\n---\n')
    expect(await store.handleExternalTaskChange(fileAt(vault, 'Elsewhere/loose.md'))).toBeNull()
  })
})

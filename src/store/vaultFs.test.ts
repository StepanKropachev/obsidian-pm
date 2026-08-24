import type { App } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../test/fakeVault'
import { projectFolderOf, projectPathForTaskPath, projectTaskFolder } from './vaultFs'

async function vaultWith(paths: string[]): Promise<App> {
  const { app, vault } = makeFakeApp()
  for (const path of paths) {
    if (path.endsWith('/')) await vault.createFolder(path.slice(0, -1))
    else await vault.create(path, '')
  }
  return app as unknown as App
}

describe('projectPathForTaskPath', () => {
  it('reads a task in a project folder', () => {
    expect(projectPathForTaskPath('Projects/Roadmap/_tasks/design.md')).toBe('Projects/Roadmap/Roadmap.md')
  })

  it('reads an archived task in a project folder', () => {
    expect(projectPathForTaskPath('Projects/Roadmap/_tasks/Archive/old.md')).toBe('Projects/Roadmap/Roadmap.md')
  })

  it('reads a task beside a project that has not moved yet', () => {
    expect(projectPathForTaskPath('Projects/Roadmap_tasks/design.md')).toBe('Projects/Roadmap.md')
    expect(projectPathForTaskPath('Projects/Roadmap_tasks/Archive/old.md')).toBe('Projects/Roadmap.md')
  })

  it('reads a task in a nested sub-project', () => {
    expect(projectPathForTaskPath('Projects/Roadmap/Q3/_tasks/ship.md')).toBe('Projects/Roadmap/Q3/Q3.md')
  })

  it('ignores a note outside any task storage', () => {
    expect(projectPathForTaskPath('Notes/idea.md')).toBeNull()
    expect(projectPathForTaskPath('_tasks/loose.md')).toBeNull()
  })
})

describe('projectTaskFolder', () => {
  it('puts task storage inside the folder a project owns', async () => {
    const app = await vaultWith(['Projects/Roadmap/Roadmap.md'])
    expect(projectFolderOf(app, 'Projects/Roadmap/Roadmap.md')).toBe('Projects/Roadmap')
    expect(projectTaskFolder(app, 'Projects/Roadmap/Roadmap.md')).toBe('Projects/Roadmap/_tasks')
  })

  it('keeps a project that has not moved yet beside its task folder', async () => {
    const app = await vaultWith(['Projects/Roadmap.md', 'Projects/Roadmap_tasks/'])
    expect(projectFolderOf(app, 'Projects/Roadmap.md')).toBeNull()
    expect(projectTaskFolder(app, 'Projects/Roadmap.md')).toBe('Projects/Roadmap_tasks')
  })

  it('keeps the storage of a note renamed inside the folder it owns', async () => {
    const app = await vaultWith(['Projects/Roadmap/Plan.md', 'Projects/Roadmap/_tasks/'])
    expect(projectTaskFolder(app, 'Projects/Roadmap/Plan.md')).toBe('Projects/Roadmap/_tasks')
  })

  it('does not hand a sub-project the folder note owner storage', async () => {
    const app = await vaultWith([
      'Projects/Roadmap/Roadmap.md',
      'Projects/Roadmap/_tasks/',
      'Projects/Roadmap/Loose.md'
    ])
    expect(projectFolderOf(app, 'Projects/Roadmap/Loose.md')).toBeNull()
    expect(projectTaskFolder(app, 'Projects/Roadmap/Loose.md')).toBe('Projects/Roadmap/Loose_tasks')
  })

  it('gives a project at the vault root its own folder', async () => {
    const app = await vaultWith(['Roadmap/Roadmap.md'])
    expect(projectTaskFolder(app, 'Roadmap/Roadmap.md')).toBe('Roadmap/_tasks')
    expect(projectTaskFolder(app, 'Roadmap.md')).toBe('Roadmap_tasks')
  })
})

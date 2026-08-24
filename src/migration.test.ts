import type { App } from 'obsidian'
import { TFile } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { makeFakeApp } from '../test/fakeVault'
import { migrateProjectLayout } from './migration'
import type PMPlugin from './main'
import { ProjectStore, VaultIndex } from './store'
import { DEFAULT_SETTINGS, makeDefaultFilter, type PMSettings } from './types'

const projectNote = (id: string, title: string): string =>
  ['---', 'pm-project: true', `id: ${id}`, `title: ${title}`, 'taskIds:', '  - t1', '---', ''].join('\n')

const taskNote = (id: string, title: string, projectId: string): string =>
  ['---', 'pm-task: true', `id: ${id}`, `projectId: ${projectId}`, `title: ${title}`, 'status: todo', '---', ''].join(
    '\n'
  )

interface FakeLeaf {
  state: Record<string, unknown>
  getViewState: () => { type: string; state: Record<string, unknown> }
  setViewState: (viewState: { type: string; state: Record<string, unknown> }) => void
}

function fakeLeaf(state: Record<string, unknown>): FakeLeaf {
  const leaf: FakeLeaf = {
    state,
    getViewState: () => ({ type: 'pm-project', state: leaf.state }),
    setViewState: (viewState) => {
      leaf.state = viewState.state
    }
  }
  return leaf
}

async function legacyVault(leaves: FakeLeaf[]): Promise<{ plugin: PMPlugin; app: App; settings: PMSettings }> {
  const { app, vault } = makeFakeApp({ liveMetadataCache: true })
  const typed = app as unknown as App
  await vault.create('Projects/Roadmap.md', projectNote('p1', 'Roadmap'))
  await vault.create('Projects/Roadmap_tasks/design.md', taskNote('t1', 'Design', 'p1'))
  await vault.create('Projects/Roadmap_tasks/Archive/old.md', taskNote('t2', 'Old', 'p1'))

  const settings: PMSettings = structuredClone(DEFAULT_SETTINGS)
  const index = new VaultIndex(typed, () => settings)
  index.build()
  const store = new ProjectStore(typed, () => settings, index)

  const plugin = {
    app: {
      ...app,
      workspace: {
        iterateAllLeaves: (visit: (leaf: FakeLeaf) => void) => {
          for (const leaf of leaves) visit(leaf)
        }
      }
    },
    index,
    store,
    settings,
    saveSettings: async () => {}
  } as unknown as PMPlugin

  return { plugin, app: typed, settings }
}

describe('migrateProjectLayout', () => {
  it('moves a project and its tasks into a folder of its own', async () => {
    const { plugin, app } = await legacyVault([])

    await migrateProjectLayout(plugin)

    expect(app.vault.getAbstractFileByPath('Projects/Roadmap/Roadmap.md')).toBeInstanceOf(TFile)
    expect(app.vault.getAbstractFileByPath('Projects/Roadmap/_tasks/design.md')).toBeInstanceOf(TFile)
    expect(app.vault.getAbstractFileByPath('Projects/Roadmap/_tasks/Archive/old.md')).toBeInstanceOf(TFile)
    expect(app.vault.getAbstractFileByPath('Projects/Roadmap_tasks')).toBeNull()
  })

  it('carries the filters, saved views and collapsed state over to the new path', async () => {
    const { plugin, settings } = await legacyVault([])
    settings.projectFilters['project:Projects/Roadmap.md'] = { filter: makeDefaultFilter(), activeSavedViewId: null }
    settings.scopeViews['subtree:Projects/Roadmap.md'] = []
    settings.collapsedTasks['Projects/Roadmap.md'] = ['t1']
    settings.collapsedProjects.push('Projects/Roadmap.md')

    await migrateProjectLayout(plugin)

    expect(settings.projectFilters['project:Projects/Roadmap/Roadmap.md']).toBeDefined()
    expect(settings.projectFilters['project:Projects/Roadmap.md']).toBeUndefined()
    expect(settings.scopeViews['subtree:Projects/Roadmap/Roadmap.md']).toBeDefined()
    expect(settings.collapsedTasks['Projects/Roadmap/Roadmap.md']).toEqual(['t1'])
    expect(settings.collapsedProjects).toEqual(['Projects/Roadmap/Roadmap.md'])
  })

  it('retargets the tabs the workspace restored before it ran', async () => {
    const scoped = fakeLeaf({ scope: { kind: 'subtree', path: 'Projects/Roadmap.md' } })
    const overview = fakeLeaf({ filePath: 'Projects/Roadmap.md' })
    const task = fakeLeaf({ filePath: 'Projects/Roadmap_tasks/design.md', projectPath: 'Projects/Roadmap.md' })
    const unrelated = fakeLeaf({ filePath: 'Notes/idea.md' })
    const { plugin } = await legacyVault([scoped, overview, task, unrelated])

    await migrateProjectLayout(plugin)

    expect(scoped.state.scope).toEqual({ kind: 'subtree', path: 'Projects/Roadmap/Roadmap.md' })
    expect(overview.state.filePath).toBe('Projects/Roadmap/Roadmap.md')
    expect(task.state.filePath).toBe('Projects/Roadmap/_tasks/design.md')
    expect(task.state.projectPath).toBe('Projects/Roadmap/Roadmap.md')
    expect(unrelated.state.filePath).toBe('Notes/idea.md')
  })

  it('does nothing on a second run', async () => {
    const { plugin, app } = await legacyVault([])
    await migrateProjectLayout(plugin)
    const before = app.vault.getAbstractFileByPath('Projects/Roadmap/Roadmap.md')

    await migrateProjectLayout(plugin)

    expect(app.vault.getAbstractFileByPath('Projects/Roadmap/Roadmap.md')).toBe(before)
    expect(app.vault.getAbstractFileByPath('Projects/Roadmap/Roadmap')).toBeNull()
  })
})

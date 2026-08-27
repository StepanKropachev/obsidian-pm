import type { App } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../test/fakeVault'
import { DEFAULT_SETTINGS, makeTask, type PMSettings, type Project, type StatusConfig } from '../types'
import { ProjectStore } from './ProjectStore'
import { ProjectScope, resolveScopePaths, scopeKey } from './ProjectScope'
import { VaultIndex } from './VaultIndex'

const SETTINGS: PMSettings = { ...DEFAULT_SETTINGS }

const SHIPPED: StatusConfig[] = [{ id: 'shipped', label: 'Shipped', color: '#0a0', icon: '', complete: true }]

function newStore(): ProjectStore {
  const { app } = makeFakeApp()
  return new ProjectStore(app as unknown as App, () => SETTINGS)
}

describe('scopeKey', () => {
  it('is stable per spec, and distinguishes a project from its subtree', () => {
    expect(scopeKey({ kind: 'project', path: 'A.md' })).toBe('project:A.md')
    expect(scopeKey({ kind: 'subtree', path: 'A.md' })).toBe('subtree:A.md')
    expect(scopeKey({ kind: 'vault' })).toBe('vault')
  })
})

describe('resolveScopePaths', () => {
  let index: VaultIndex

  beforeEach(async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const note = (id: string, title: string, parent = '') =>
      `---\npm-project: true\nid: ${id}\ntitle: ${title}\n${parent ? `parent: "[[${parent}]]"\n` : ''}---\n`
    await fake.vault.create('Work/Platform.md', note('p1', 'Platform'))
    await fake.vault.create('Work/Billing.md', note('p2', 'Billing', 'Platform'))
    await fake.vault.create('Work/Deep.md', note('p3', 'Deep', 'Billing'))
    await fake.vault.create('Personal/Garden.md', note('p4', 'Garden'))
    index = new VaultIndex(fake.app as unknown as App, () => SETTINGS)
    index.build()
  })

  it('resolves one project', () => {
    expect(resolveScopePaths({ kind: 'project', path: 'Work/Platform.md' }, index)).toEqual(['Work/Platform.md'])
  })

  it('resolves a project and every level below it, the project first', () => {
    expect(resolveScopePaths({ kind: 'subtree', path: 'Work/Platform.md' }, index)).toEqual([
      'Work/Platform.md',
      'Work/Billing.md',
      'Work/Deep.md'
    ])
  })

  it('resolves a folder', () => {
    expect(resolveScopePaths({ kind: 'folder', path: 'Personal' }, index)).toEqual(['Personal/Garden.md'])
  })

  it('resolves the whole vault', () => {
    expect(resolveScopePaths({ kind: 'vault' }, index)).toHaveLength(4)
  })

  it('resolves a project that no longer exists to nothing', () => {
    expect(resolveScopePaths({ kind: 'project', path: 'Gone.md' }, index)).toEqual([])
  })
})

describe('ProjectScope', () => {
  let store: ProjectStore
  let alpha: Project
  let beta: Project

  beforeEach(async () => {
    store = newStore()
    alpha = await store.createProject('Alpha', 'Projects')
    beta = await store.createProject('Beta', 'Work')
    await store.insertTask(alpha, makeTask({ title: 'Alpha one' }))
    await store.insertTask(beta, makeTask({ title: 'Beta one' }))
  })

  it('lists the tasks of every project in scope order', () => {
    const scope = new ProjectScope({ kind: 'vault' }, [alpha, beta], store)
    expect(scope.tasks().map((t) => t.title)).toEqual(['Alpha one', 'Beta one'])
  })

  it('answers which project owns a task', () => {
    const scope = new ProjectScope({ kind: 'vault' }, [alpha, beta], store)
    expect(scope.projectOf(beta.tasks[0].id)).toBe(beta)
    expect(scope.projectOf('nope')).toBeNull()
  })

  it('takes the primary project as the target for new work', () => {
    const scope = new ProjectScope({ kind: 'vault' }, [alpha, beta], store)
    expect(scope.primary).toBe(alpha)
    expect(scope.isMulti).toBe(true)
  })

  it('merges palettes across projects, the primary first', async () => {
    await store.updateProject(beta, { config: { statuses: SHIPPED } })
    const scope = new ProjectScope({ kind: 'vault' }, [alpha, beta], store)

    const ids = scope.config.statuses.map((s) => s.id)
    expect(ids.slice(0, DEFAULT_SETTINGS.statuses.length)).toEqual(DEFAULT_SETTINGS.statuses.map((s) => s.id))
    expect(ids).toContain('shipped')
  })

  it('keeps terminal-status checks on the owning project', async () => {
    await store.updateProject(beta, { config: { statuses: SHIPPED } })
    const scope = new ProjectScope({ kind: 'vault' }, [alpha, beta], store)

    expect(scope.configOf(beta.tasks[0].id).statuses.some((s) => s.id === 'done')).toBe(false)
    expect(scope.configOf(alpha.tasks[0].id).statuses.some((s) => s.id === 'done')).toBe(true)
  })

  it('leaves a single-project scope reading exactly like the project', () => {
    const scope = new ProjectScope({ kind: 'project', path: alpha.filePath }, [alpha], store)
    expect(scope.isMulti).toBe(false)
    expect(scope.tasks()).toBe(alpha.tasks)
    expect(scope.config).toEqual(store.configFor(alpha))
    expect(scope.label()).toBe('Alpha')
  })

  it('unions custom fields and team members', async () => {
    await store.updateProject(alpha, {
      customFields: [{ id: 'cf1', name: 'Client', type: 'text' }],
      teamMembers: ['Ana']
    })
    await store.updateProject(beta, {
      customFields: [{ id: 'cf2', name: 'Risk', type: 'text' }],
      teamMembers: ['Ana', 'Bo']
    })
    const scope = new ProjectScope({ kind: 'vault' }, [alpha, beta], store)

    expect(scope.customFields().map((f) => f.id)).toEqual(['cf1', 'cf2'])
    expect(scope.teamMembers()).toEqual(['Ana', 'Bo'])
  })
})

describe('ProjectScope custom fields down a subtree', () => {
  let store: ProjectStore
  let parent: Project
  let child: Project

  beforeEach(async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    const index = new VaultIndex(app, () => SETTINGS)
    store = new ProjectStore(app, () => SETTINGS, index)
    parent = await store.createProject('Platform', 'Work')
    child = await store.createProject('Billing', 'Work')
    await store.updateProject(child, { parentPath: parent.filePath })
    await store.updateProject(parent, { customFields: [{ id: 'cf-client', name: 'Client', type: 'text' }] })
    index.build()
  })

  it('gives a sub-project the fields its parent declares', () => {
    expect(store.configFor(child).customFields.map((f) => f.name)).toEqual(['Client'])
  })

  it('shows one column for a field a parent and its child share', () => {
    const scope = new ProjectScope({ kind: 'subtree', path: parent.filePath }, [parent, child], store)
    expect(scope.customFields().map((f) => f.id)).toEqual(['cf-client'])
  })

  it('leaves the field out of a sub-project that hides it', async () => {
    await store.updateProject(child, { config: { hiddenCustomFields: ['cf-client'] } })
    expect(store.configFor(child).customFields).toEqual([])
  })
})

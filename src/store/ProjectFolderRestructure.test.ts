import type { App } from 'obsidian'
import { TFile, TFolder } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../test/fakeVault'
import { DEFAULT_SETTINGS, makeTask, type PMSettings } from '../types'
import { ProjectStore } from './ProjectStore'
import { flattenTasks } from './TaskTreeOps'
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

async function seedLegacyProject(
  vault: FakeVault,
  dir: string,
  name: string,
  opts: { body?: string; taskIds?: string[] } = {}
): Promise<void> {
  const fm = ['---', 'pm-project: true', `id: ${name}-1`, `title: ${name}`, `path: ${dir}`]
  if (opts.taskIds?.length) {
    fm.push('taskIds:')
    for (const id of opts.taskIds) fm.push(`  - ${id}`)
  } else {
    fm.push('taskIds: []')
  }
  fm.push('---', '', opts.body ?? 'body')
  await vault.create(`${dir}/${name}.md`, fm.join('\n'))
}

describe('INT-020 project-folder restructure — migration edges', () => {
  it('migration is idempotent: a second discover leaves the nested project untouched', async () => {
    const { store, vault } = newStore()
    await seedLegacyProject(vault, 'Projects', 'Legacy', { taskIds: ['t-1'] })
    await vault.createFolder('Projects/Legacy_tasks')
    await vault.create(
      'Projects/Legacy_tasks/t-1.md',
      ['---', 'pm-task: true', 'id: t-1', 'title: Task', '---', '', 'task body'].join('\n')
    )

    await store.discoverProjects()
    // Migrated into the nested layout.
    expect(vault.getAbstractFileByPath('Projects/Legacy/Legacy.md')).toBeInstanceOf(TFile)
    expect(vault.getAbstractFileByPath('Projects/Legacy/Legacy_tasks/t-1.md')).toBeInstanceOf(TFile)
    const noteAfterFirst = await vault.cachedRead(fileAt(vault, 'Projects/Legacy/Legacy.md'))

    // A second discover is a no-op — the note is not moved again or rewritten.
    await store.discoverProjects()
    expect(vault.getAbstractFileByPath('Projects/Legacy/Legacy.md')).toBeInstanceOf(TFile)
    expect(vault.getAbstractFileByPath('Projects/Legacy/Legacy/Legacy.md')).toBeNull()
    expect(await vault.cachedRead(fileAt(vault, 'Projects/Legacy/Legacy.md'))).toBe(noteAfterFirst)

    // A dry-run migration reports nothing left to move.
    expect(await store.migrateLegacyProjects({ dryRun: true })).toEqual([])
  })

  it('migration preserves the project-note body and every task file across the move', async () => {
    const { store, vault } = newStore()
    await seedLegacyProject(vault, 'Areas/Ops', 'Handbook', {
      body: 'Freeform handbook prose that must survive.',
      taskIds: ['h-1', 'h-2']
    })
    await vault.createFolder('Areas/Ops/Handbook_tasks')
    await vault.create(
      'Areas/Ops/Handbook_tasks/h-1.md',
      ['---', 'pm-task: true', 'id: h-1', 'title: One', '---', '', 'first task body'].join('\n')
    )
    await vault.create(
      'Areas/Ops/Handbook_tasks/h-2.md',
      ['---', 'pm-task: true', 'id: h-2', 'title: Two', '---', '', 'second task body'].join('\n')
    )

    const found = await store.discoverProjects()

    const note = await vault.cachedRead(fileAt(vault, 'Areas/Ops/Handbook/Handbook.md'))
    expect(note).toContain('Freeform handbook prose that must survive.')
    const fm = parseFrontmatter(note).frontmatter ?? {}
    expect((fm.taskIds as unknown[]).map(String)).toEqual(['h-1', 'h-2'])
    // Task file bodies travel with the folder.
    expect(await vault.cachedRead(fileAt(vault, 'Areas/Ops/Handbook/Handbook_tasks/h-1.md'))).toContain(
      'first task body'
    )
    expect(await vault.cachedRead(fileAt(vault, 'Areas/Ops/Handbook/Handbook_tasks/h-2.md'))).toContain(
      'second task body'
    )
    // Both tasks load into the discovered project's tree.
    const proj = found.find((p) => p.title === 'Handbook')
    expect(proj).toBeDefined()
    expect(
      flattenTasks(proj?.tasks ?? [])
        .map((f) => f.task.id)
        .sort()
    ).toEqual(['h-1', 'h-2'])
    // Nothing remains at the old flat locations.
    expect(vault.getAbstractFileByPath('Areas/Ops/Handbook.md')).toBeNull()
    expect(vault.getAbstractFileByPath('Areas/Ops/Handbook_tasks')).toBeNull()
  })

  it('moveProject relocates the whole nested folder including freeform content', async () => {
    const { store, vault } = newStore()
    const created = await store.createProject('Playbook', 'Projects')
    const project = await store.loadProject(fileAt(vault, created.filePath))
    if (!project) throw new Error('load failed')
    await store.insertTask(project, makeTask({ title: 'step one' }))
    // Drop a freeform note inside the per-project folder.
    await vault.create('Projects/Playbook/notes.md', '# scratch\nfreeform')

    await store.moveProject(project, 'Areas/Field Ops')

    expect(vault.getAbstractFileByPath('Areas/Field Ops/Playbook/Playbook.md')).toBeInstanceOf(TFile)
    expect(vault.getAbstractFileByPath('Areas/Field Ops/Playbook/Playbook_tasks')).toBeInstanceOf(TFolder)
    expect(vault.getAbstractFileByPath('Areas/Field Ops/Playbook/notes.md')).toBeInstanceOf(TFile)
    // Old per-project folder is emptied out.
    expect(vault.getAbstractFileByPath('Projects/Playbook/Playbook.md')).toBeNull()
    expect(vault.getAbstractFileByPath('Projects/Playbook/notes.md')).toBeNull()
    expect(project.tasks[0]?.filePath?.startsWith('Areas/Field Ops/Playbook/Playbook_tasks/')).toBe(true)
    expect(store.projectDirectory(project)).toBe('Areas/Field Ops')
  })

  it('migration skips a legacy project whose target per-project folder is already occupied', async () => {
    const { store, vault } = newStore()
    await seedLegacyProject(vault, 'Projects', 'Taken')
    // A pre-existing folder squats the migration target.
    await vault.createFolder('Projects/Taken')
    await vault.create('Projects/Taken/keep.md', 'do not clobber')

    // Does not throw; leaves the project in its flat layout.
    await expect(store.discoverProjects()).resolves.toBeDefined()
    expect(vault.getAbstractFileByPath('Projects/Taken.md')).toBeInstanceOf(TFile)
    expect(vault.getAbstractFileByPath('Projects/Taken/keep.md')).toBeInstanceOf(TFile)
    expect(await vault.cachedRead(fileAt(vault, 'Projects/Taken/keep.md'))).toBe('do not clobber')
  })

  it('dry-run migration reports the moves without writing anything', async () => {
    const { store, vault } = newStore()
    await seedLegacyProject(vault, 'Projects', 'Dryrun')

    const moves = await store.migrateLegacyProjects({ dryRun: true })
    expect(moves).toEqual([{ from: 'Projects/Dryrun.md', to: 'Projects/Dryrun/Dryrun.md' }])
    // Nothing moved on disk.
    expect(vault.getAbstractFileByPath('Projects/Dryrun.md')).toBeInstanceOf(TFile)
    expect(vault.getAbstractFileByPath('Projects/Dryrun/Dryrun.md')).toBeNull()
  })
})

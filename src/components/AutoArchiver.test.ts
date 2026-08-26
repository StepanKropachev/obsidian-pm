import type { App } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../test/fakeVault'
import { today } from '../dates'
import type PMPlugin from '../main'
import { ProjectStore, VaultIndex } from '../store'
import { findTask } from '../store/TaskTreeOps'
import { DEFAULT_SETTINGS, makeTask, type PMSettings, type Project, type Task } from '../types'
import { AutoArchiver } from './AutoArchiver'

const daysAgo = (days: number): string => today().subtract({ days }).toString()

describe('AutoArchiver', () => {
  let app: App
  let index: VaultIndex
  let store: ProjectStore
  let settings: PMSettings
  let notices: string[]
  let archiver: AutoArchiver

  beforeEach(() => {
    app = makeFakeApp({ liveMetadataCache: true }).app as unknown as App
    settings = structuredClone(DEFAULT_SETTINGS)
    index = new VaultIndex(app, () => settings)
    store = new ProjectStore(app, () => settings, index)
    notices = []
    const plugin = {
      app,
      index,
      store,
      settings,
      showNotice: (msg: string) => notices.push(msg),
      saveSettings: () => Promise.resolve()
    } as unknown as PMPlugin
    archiver = new AutoArchiver(plugin)
  })

  async function addTask(project: Project, title: string, patch: Partial<Task> = {}): Promise<Task> {
    const task = makeTask({ title })
    await store.insertTask(project, task)
    if (Object.keys(patch).length) await store.updateTask(project, task.id, patch)
    return task
  }

  const done = (completed: string): Partial<Task> => ({ status: 'done', completed })

  function archived(project: Project, task: Task): boolean {
    return findTask(project.tasks, task.id)?.archived === true
  }

  it('does nothing when no project has a window', async () => {
    const project = await store.createProject('Roadmap', 'Projects')
    const old = await addTask(project, 'Old', done(daysAgo(30)))
    index.build()

    await archiver.check()

    expect(archived(project, old)).toBe(false)
    expect(settings.lastAutoArchiveDate).toBe('')
  })

  it('archives what has been complete for longer than the window', async () => {
    settings.autoArchiveDays = 7
    const project = await store.createProject('Roadmap', 'Projects')
    const old = await addTask(project, 'Old', done(daysAgo(30)))
    const fresh = await addTask(project, 'Fresh', done(daysAgo(2)))
    const open = await addTask(project, 'Open')
    index.build()

    await archiver.check()

    expect(archived(project, old)).toBe(true)
    expect(findTask(project.tasks, old.id)?.filePath).toMatch(/\/Archive\//)
    expect(archived(project, fresh)).toBe(false)
    expect(archived(project, open)).toBe(false)
    expect(settings.lastAutoArchiveDate).toBe(today().toString())
    expect(notices).toEqual(['Archived 1 completed task(s) in 1 project(s).'])
  })

  it('never archives a completed task carrying no completion date', async () => {
    settings.autoArchiveDays = 7
    const project = await store.createProject('Roadmap', 'Projects')
    const undated = await addTask(project, 'Undated', { status: 'done', completed: '' })
    index.build()

    await archiver.check()

    expect(archived(project, undated)).toBe(false)
  })

  it("follows a project's own window over the global one", async () => {
    settings.autoArchiveDays = 30
    const project = await store.createProject('Roadmap', 'Projects')
    const task = await addTask(project, 'Old', done(daysAgo(10)))
    await store.updateProject(project, { config: { autoArchiveDays: 7 } })
    index.build()

    await archiver.check()

    expect(archived(project, task)).toBe(true)
  })

  it('runs once a day', async () => {
    settings.autoArchiveDays = 7
    settings.lastAutoArchiveDate = today().toString()
    const project = await store.createProject('Roadmap', 'Projects')
    const old = await addTask(project, 'Old', done(daysAgo(30)))
    index.build()

    await archiver.check()

    expect(archived(project, old)).toBe(false)
  })

  it('leaves a task another project still depends on', async () => {
    settings.autoArchiveDays = 7
    const library = await store.createProject('Library', 'Projects')
    const consumer = await store.createProject('App', 'Projects')
    const api = await addTask(library, 'API', done(daysAgo(30)))
    await addTask(consumer, 'Client', { dependencies: [api.id] })
    index.build()

    await archiver.check()

    expect(archived(library, api)).toBe(false)
  })

  it('takes everything completed when the command runs against a project with no window', async () => {
    const project = await store.createProject('Roadmap', 'Projects')
    const todayDone = await addTask(project, 'Just finished', done(today().toString()))
    index.build()

    const plans = await archiver.plan([project.filePath], true)
    await archiver.apply(plans)

    expect(archived(project, todayDone)).toBe(true)
  })
})

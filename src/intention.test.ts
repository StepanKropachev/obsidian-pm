// @vitest-environment happy-dom
//
// INTENTION TEST — the RED win condition for the four features below.
//
// This file is the executable contract for a build->test->debug loop. It is
// authored BEFORE the features exist, so it MUST run to completion and fail on
// ASSERTIONS (or clean feature-detection), never on compile errors or
// import-of-nonexistent-symbol crashes. New store surfaces are probed as
// optional methods (feature-detected with `toBeTypeOf('function')` before any
// call); the calendar primitive is loaded through a runtime dynamic import so a
// missing module fails an assertion rather than crashing collection.
//
// Features under test (each a `describe`, each requirement an `it` "R<n>: ..."):
//   1. External ingestion  — pm-task files created manually/by-AI are detected,
//      backfilled on disk, and wired into project/parent ordering. (R1–R7)
//   2. Per-project dirs     — projects carry a `path` frontmatter directory;
//      discovery scans the vault; legacy projects keep working. (R8–R11)
//   3. Bi-directional renames — vault<->plugin renames stay in sync, no echo
//      loops, task folders tracked. (R12–R15)
//   4. Calendar date picker — a Sun–Sat grid primitive, plugin CSS classes
//      only, emitting YYYY-MM-DD strings, cataloged in the styleguide. (R16–R21)

import type { App, TAbstractFile } from 'obsidian'
import { TFile, TFolder } from 'obsidian'
import { beforeAll, describe, expect, it } from 'vitest'
import { FakeVault, makeFakeApp } from '../test/fakeVault'
import { findTask, parseFrontmatter, ProjectStore } from './store'
import { DEFAULT_SETTINGS, makeTask, type PMSettings, type Project, type Task } from './types'

// ─── Harness ──────────────────────────────────────────────────────────────

const SETTINGS: PMSettings = { ...DEFAULT_SETTINGS }

// `window.document` (there is no Obsidian workspace/activeDocument in the vitest
// happy-dom environment).
const doc: Document = window.document

/** New store surfaces the four features are expected to add. Probed, not imported. */
interface StoreProbe {
  ingestExternalTask?: (project: Project, file: TFile) => Promise<Task | null>
  discoverProjects?: () => Promise<Project[]>
  projectDirectory?: (project: Project) => string
  isProjectRelevantPath?: (path: string) => boolean
  migrateLegacyProjects?: (options?: { dryRun?: boolean }) => Promise<unknown>
  moveProject?: (project: Project, newDir: string) => Promise<void>
  renameProject?: (project: Project, newTitle: string) => Promise<void>
  handleExternalRename?: (oldPath: string, file: TFile) => Promise<void>
  // Feature 8 (INT-021) — content-aware detection.
  hasBodyContent?: (file: TFile) => Promise<boolean> | boolean
  bodyContentLines?: (file: TFile) => Promise<number> | number
}

function newStore(): { store: ProjectStore; vault: FakeVault; app: App } {
  const { app, vault } = makeFakeApp()
  const store = new ProjectStore(app as unknown as App, () => SETTINGS)
  return { store, vault, app: app as unknown as App }
}

function probe(store: ProjectStore): StoreProbe {
  return store
}

function fileAt(vault: FakeVault, path: string): TFile {
  const f: TAbstractFile | null = vault.getAbstractFileByPath(path)
  if (!(f instanceof TFile)) throw new Error(`expected a file at ${path}`)
  return f
}

async function frontmatterOf(vault: FakeVault, path: string): Promise<Record<string, unknown>> {
  const content = await vault.cachedRead(fileAt(vault, path))
  return parseFrontmatter(content).frontmatter ?? {}
}

function taskFileBody(lines: string[]): string {
  return lines.join('\n')
}

// ─── Feature 1 — external task ingestion (O1, O2, M1) ───────────────────────

describe('Feature 1 — external task ingestion', () => {
  it('R1: external task file detected', async () => {
    // negative-control: a plain note with no `pm-task: true` must NOT be ingested (see R6).
    const { store, vault } = newStore()
    const project = await store.createProject('Inbox', 'Projects')
    const path = 'Projects/Inbox/Inbox_tasks/manual-add.md'
    await vault.create(path, taskFileBody(['---', 'pm-task: true', 'title: Manually added task', '---', '', 'A body.']))
    const file = fileAt(vault, path)

    const ingest = probe(store).ingestExternalTask
    expect(ingest, 'ProjectStore.ingestExternalTask(project, file) must exist').toBeTypeOf('function')
    if (!ingest) return
    const task = await ingest.call(store, project, file)
    expect(task).not.toBeNull()
  })

  it('R2: ingested task appears in-tree', async () => {
    // negative-control: ingest that returns a task but never adds it to project.tasks.
    const { store, vault } = newStore()
    const project = await store.createProject('Inbox', 'Projects')
    const path = 'Projects/Inbox/Inbox_tasks/appears.md'
    await vault.create(path, taskFileBody(['---', 'pm-task: true', 'title: Shows up', '---', '', 'body']))

    const ingest = probe(store).ingestExternalTask
    expect(ingest).toBeTypeOf('function')
    if (!ingest) return
    const task = await ingest.call(store, project, fileAt(vault, path))
    expect(task).not.toBeNull()
    if (!task) return
    expect(findTask(project.tasks, task.id)).toBeDefined()
  })

  it('R3: missing id backfilled on disk', async () => {
    // negative-control: a file whose `id` stays blank/absent after ingestion.
    const { store, vault } = newStore()
    const project = await store.createProject('Inbox', 'Projects')
    const path = 'Projects/Inbox/Inbox_tasks/no-id.md'
    // No `id` key at all — the store must backfill and persist one.
    await vault.create(path, taskFileBody(['---', 'pm-task: true', 'title: Needs an id', '---', '', 'body']))

    const ingest = probe(store).ingestExternalTask
    expect(ingest).toBeTypeOf('function')
    if (!ingest) return
    await ingest.call(store, project, fileAt(vault, path))

    // Forensic: the on-disk frontmatter now carries a non-empty id.
    const fm = await frontmatterOf(vault, path)
    const id = fm.id
    expect(typeof id).toBe('string')
    expect(typeof id === 'string' ? id.length : 0).toBeGreaterThan(0)
  })

  it('R4: blank fields get defaults', async () => {
    // negative-control: blank `status:`/`priority:` left as null/'' instead of defaults.
    const { store, vault } = newStore()
    const project = await store.createProject('Inbox', 'Projects')
    const path = 'Projects/Inbox/Inbox_tasks/blanks.md'
    await vault.create(
      path,
      taskFileBody(['---', 'pm-task: true', 'title: Blank fields', 'status:', 'priority:', '---', '', 'body'])
    )

    const ingest = probe(store).ingestExternalTask
    expect(ingest).toBeTypeOf('function')
    if (!ingest) return
    const task = await ingest.call(store, project, fileAt(vault, path))
    expect(task).not.toBeNull()
    if (!task) return
    // makeTask defaults: status 'todo', priority 'medium'.
    expect(task.status).toBe('todo')
    expect(task.priority).toBe('medium')
  })

  it('R5: task wired into ordering ids', async () => {
    // negative-control: task ingested but its id never added to the project's taskIds.
    const { store, vault } = newStore()
    const project = await store.createProject('Inbox', 'Projects')
    const path = 'Projects/Inbox/Inbox_tasks/ordered.md'
    await vault.create(path, taskFileBody(['---', 'pm-task: true', 'title: Ordered', '---', '', 'body']))

    const ingest = probe(store).ingestExternalTask
    expect(ingest).toBeTypeOf('function')
    if (!ingest) return
    const task = await ingest.call(store, project, fileAt(vault, path))
    expect(task).not.toBeNull()
    if (!task) return

    // Forensic: the project file's persisted taskIds include the new id.
    const fm = await frontmatterOf(vault, project.filePath)
    const taskIds = Array.isArray(fm.taskIds) ? (fm.taskIds as unknown[]).map(String) : []
    expect(taskIds).toContain(task.id)
  })

  it('R6: malformed frontmatter file ignored', async () => {
    // negative-control (this IS the negative branch): a non-pm-task note must be
    // ignored — ingest returns null, the tree is untouched, and nothing throws.
    const { store, vault } = newStore()
    const project = await store.createProject('Inbox', 'Projects')
    const before = project.tasks.length
    const path = 'Projects/Inbox/Inbox_tasks/not-a-task.md'
    await vault.create(path, taskFileBody(['---', 'title: Just a note', '---', '', 'not a pm task']))

    const ingest = probe(store).ingestExternalTask
    expect(ingest).toBeTypeOf('function')
    if (!ingest) return
    const task = await ingest.call(store, project, fileAt(vault, path))
    expect(task).toBeNull()
    expect(project.tasks.length).toBe(before)
  })

  it('R7: self-writes skip re-ingestion', async () => {
    // negative-control: backfill write NOT self-marked -> the modify event re-ingests (echo).
    const { store, vault } = newStore()
    const project = await store.createProject('Inbox', 'Projects')
    const path = 'Projects/Inbox/Inbox_tasks/selfmark.md'
    await vault.create(path, taskFileBody(['---', 'pm-task: true', 'title: Self mark', '---', '', 'body']))

    const ingest = probe(store).ingestExternalTask
    expect(ingest).toBeTypeOf('function')
    if (!ingest) return
    await ingest.call(store, project, fileAt(vault, path))
    // The backfill write must be self-marked so the resulting modify event is skipped.
    expect(store.consumeSelfWrite(path)).toBe(true)
  })
})

// ─── Feature 2 — per-project directories (O3, M2) ───────────────────────────

describe('Feature 2 — per-project directories', () => {
  it('R8: project path frontmatter field', async () => {
    // negative-control: project file omits `path`, so an AI agent cannot learn its directory.
    // Pinned contract: frontmatter key `path` = vault-relative directory containing the project file.
    const { store, vault } = newStore()
    const project = await store.createProject('Ops Board', 'Areas/Ops')
    const fm = await frontmatterOf(vault, project.filePath)
    expect(fm.path).toBe('Areas/Ops')
  })

  it('R9: discovery scans vault-wide', async () => {
    // negative-control: a project file outside the configured folder is never found.
    const { store, vault } = newStore()
    const path = 'Random/Place/Wandering.md'
    await vault.create(
      path,
      taskFileBody(['---', 'pm-project: true', 'id: wander-1', 'title: Wandering', 'taskIds: []', '---', '', 'body'])
    )

    const discover = probe(store).discoverProjects
    expect(discover, 'ProjectStore.discoverProjects() must exist').toBeTypeOf('function')
    if (!discover) return
    const found = await discover.call(store)
    // INT-020: the flat-seeded project is migrated on load into its nested
    // per-project folder, so it is discovered at the nested note path.
    expect(found.some((p) => p.filePath === 'Random/Place/Wandering/Wandering.md')).toBe(true)
  })

  it('R10: create-project accepts custom path', async () => {
    // negative-control: createProject ignores the directory and dumps into the global folder.
    const { store, vault } = newStore()
    const dir = 'Clients/Acme'
    const project = await store.createProject('Acme Rollout', dir)
    // Files are co-located under the custom directory, inside the per-project folder.
    expect(vault.getAbstractFileByPath(`${dir}/Acme Rollout/Acme Rollout_tasks`)).toBeInstanceOf(TFolder)

    const directoryOf = probe(store).projectDirectory
    expect(directoryOf, 'ProjectStore.projectDirectory(project) must exist').toBeTypeOf('function')
    if (!directoryOf) return
    expect(directoryOf.call(store, project)).toBe(dir)
  })

  it('R11: existing projects keep working', async () => {
    // negative-control: legacy project (no `path` key) fails to load or falls back to the wrong dir.
    const { store, vault } = newStore()
    await vault.create(
      'Projects/Legacy One.md',
      taskFileBody(['---', 'pm-project: true', 'id: legacy-1', 'title: Legacy One', 'taskIds: []', '---', '', 'body'])
    )
    const project = await store.loadProject(fileAt(vault, 'Projects/Legacy One.md'))
    expect(project).not.toBeNull()
    if (!project) return
    // Regression: a legacy project still loads.
    expect(project.title).toBe('Legacy One')

    // Contract fallback: absent `path` resolves to the file's actual parent folder.
    const directoryOf = probe(store).projectDirectory
    expect(directoryOf).toBeTypeOf('function')
    if (!directoryOf) return
    expect(directoryOf.call(store, project)).toBe('Projects')
  })

  it('R26: moving an existing project relocates its file and tasks folder', async () => {
    // negative-control: the `path` field changes but the project file / tasks
    // folder stay at the old location, orphaning the tasks.
    // Completeness of INT-014: the existing-project settings surface must be able
    // to re-point a project's folder; on save the WHOLE project folder moves.
    const { store, vault } = newStore()
    const created = await store.createProject('Relocatable', 'Projects')
    const project = await store.loadProject(fileAt(vault, created.filePath))
    expect(project).not.toBeNull()
    if (!project) return
    await store.insertTask(project, makeTask({ title: 'attached' }))

    const move = probe(store).moveProject
    expect(move, 'ProjectStore.moveProject(project, newDir) must exist').toBeTypeOf('function')
    if (!move) return
    await move.call(store, project, 'Areas/Portfolio')

    // Forensic: the project file + its `<Name>_tasks` folder now live under the
    // new directory (inside the per-project folder), and nothing remains at the old location.
    expect(vault.getAbstractFileByPath('Areas/Portfolio/Relocatable/Relocatable.md')).toBeInstanceOf(TFile)
    expect(vault.getAbstractFileByPath('Areas/Portfolio/Relocatable/Relocatable_tasks')).toBeInstanceOf(TFolder)
    expect(vault.getAbstractFileByPath('Projects/Relocatable/Relocatable.md')).toBeNull()
    expect(vault.getAbstractFileByPath('Projects/Relocatable/Relocatable_tasks')).toBeNull()

    // The task file moved with the folder (not orphaned at the old path).
    const movedTaskPath = project.tasks[0]?.filePath ?? ''
    expect(movedTaskPath.startsWith('Areas/Portfolio/Relocatable/Relocatable_tasks/')).toBe(true)
    expect(vault.getAbstractFileByPath(movedTaskPath)).toBeInstanceOf(TFile)

    // The persisted `path` frontmatter + resolved directory both track the new dir.
    const fm = await frontmatterOf(vault, project.filePath)
    expect(fm.path).toBe('Areas/Portfolio')
    const directoryOf = probe(store).projectDirectory
    expect(directoryOf).toBeTypeOf('function')
    if (!directoryOf) return
    expect(directoryOf.call(store, project)).toBe('Areas/Portfolio')
  })

  it('R27: moving a project into a directory with spaces is handled literally', async () => {
    // negative-control: spaces truncate the path or split it into the wrong
    // directory, so the files are not discoverable at the intended location.
    const { store, vault } = newStore()
    const created = await store.createProject('Quarterly Plan', 'Projects')
    const project = await store.loadProject(fileAt(vault, created.filePath))
    expect(project).not.toBeNull()
    if (!project) return
    await store.insertTask(project, makeTask({ title: 'line item' }))

    const move = probe(store).moveProject
    expect(move, 'ProjectStore.moveProject(project, newDir) must exist').toBeTypeOf('function')
    if (!move) return
    const spacedDir = 'Areas/Income Projects'
    await move.call(store, project, spacedDir)

    // Files land at the LITERAL spaced path (no truncation, no wrong split) and
    // stay discoverable there; nothing is left behind at the old location.
    expect(vault.getAbstractFileByPath(`${spacedDir}/Quarterly Plan/Quarterly Plan.md`)).toBeInstanceOf(TFile)
    expect(vault.getAbstractFileByPath(`${spacedDir}/Quarterly Plan/Quarterly Plan_tasks`)).toBeInstanceOf(TFolder)
    expect(vault.getAbstractFileByPath('Projects/Quarterly Plan/Quarterly Plan.md')).toBeNull()

    const movedTaskPath = project.tasks[0]?.filePath ?? ''
    expect(movedTaskPath.startsWith(`${spacedDir}/Quarterly Plan/Quarterly Plan_tasks/`)).toBe(true)

    const fm = await frontmatterOf(vault, project.filePath)
    expect(fm.path).toBe(spacedDir)
    expect(project.filePath).toBe(`${spacedDir}/Quarterly Plan/Quarterly Plan.md`)
  })

  it('R28: dashboard refresh predicate is vault-wide, not folder-scoped', async () => {
    // negative-control: the predicate hard-codes the global `projectsFolder`
    // prefix, so a `pm-project: true` file filed in a custom category directory
    // reads as irrelevant — the exact INT-014 completeness gap. Discovery went
    // vault-wide, but the dashboard's live-refresh guard still only matched the
    // global folder, so a project created ANYWHERE else appeared only on manual
    // reload. The dashboard must route its refresh guard through a store predicate
    // that answers "should the project dashboard refresh for this path?" the same
    // vault-wide way discovery does.
    const { store, vault, app } = newStore()

    // A pm-project file filed OUTSIDE the global projects folder (a custom category dir).
    const customPath = 'Areas/Community/Neighborhood Cleanup.md'
    await vault.create(
      customPath,
      taskFileBody([
        '---',
        'pm-project: true',
        'id: nc-1',
        'title: Neighborhood Cleanup',
        'taskIds: []',
        '---',
        '',
        'body'
      ])
    )
    // An unrelated markdown note that is NOT a project.
    const notePath = 'Notes/Some Random Note.md'
    await vault.create(notePath, taskFileBody(['---', 'title: Just a note', '---', '', 'not a project']))

    // Obsidian populates metadataCache on create; teach the fake cache to report
    // the custom-dir file as a project and the note as a plain file. (Cast away the
    // strict CachedMetadata shape — the predicate only reads the pm-project flag.)
    ;(
      app.metadataCache as unknown as { getFileCache: (f: TFile) => { frontmatter?: Record<string, unknown> } | null }
    ).getFileCache = (file: TFile) =>
      file.path === customPath ? { frontmatter: { 'pm-project': true } } : { frontmatter: {} }

    const relevant = probe(store).isProjectRelevantPath
    expect(relevant, 'ProjectStore.isProjectRelevantPath(path) must exist').toBeTypeOf('function')
    if (!relevant) return

    // The custom-dir project must be seen as dashboard-relevant even though it is
    // NOT under the global projectsFolder ('Projects'): discovery is vault-wide, so
    // the live-refresh guard must be too.
    expect(relevant.call(store, customPath), 'a pm-project file in a custom dir must be dashboard-relevant').toBe(true)
    // An unrelated note must NOT trigger a dashboard refresh.
    expect(relevant.call(store, notePath), 'an unrelated note must not be dashboard-relevant').toBe(false)
  })
})

// ─── Feature 3 — bi-directional renames (O4, M3) ────────────────────────────

describe('Feature 3 — bi-directional renames', () => {
  it('R12: vault rename updates item name', async () => {
    // negative-control: external rename leaves the in-memory project title stale.
    const { store, vault } = newStore()
    const created = await store.createProject('Alpha', 'Projects')
    const project = await store.loadProject(fileAt(vault, created.filePath))
    expect(project).not.toBeNull()
    if (!project) return

    const oldPath = project.filePath
    await vault.rename(fileAt(vault, oldPath), 'Projects/Beta.md')

    const handle = probe(store).handleExternalRename
    expect(handle, 'ProjectStore.handleExternalRename(oldPath, file) must exist').toBeTypeOf('function')
    if (!handle) return
    await handle.call(store, oldPath, fileAt(vault, 'Projects/Beta.md'))
    expect(project.title).toBe('Beta')
  })

  it('R13: plugin rename moves file/folder', async () => {
    // negative-control: plugin rename updates memory but leaves the file at its old path.
    const { store, vault } = newStore()
    const created = await store.createProject('Gamma', 'Projects')
    const project = await store.loadProject(fileAt(vault, created.filePath))
    expect(project).not.toBeNull()
    if (!project) return
    await store.insertTask(project, makeTask({ title: 'child' }))

    const rename = probe(store).renameProject
    expect(rename, 'ProjectStore.renameProject(project, newTitle) must exist').toBeTypeOf('function')
    if (!rename) return
    await rename.call(store, project, 'Delta')

    // Forensic: the .md and its _tasks folder now live at the new nested path; the old ones are gone.
    expect(vault.getAbstractFileByPath('Projects/Delta/Delta.md')).toBeInstanceOf(TFile)
    expect(vault.getAbstractFileByPath('Projects/Gamma/Gamma.md')).toBeNull()
    expect(vault.getAbstractFileByPath('Projects/Delta/Delta_tasks')).toBeInstanceOf(TFolder)
  })

  it('R14: rename echo loop prevented', async () => {
    // negative-control: plugin rename writes without self-marking -> the vault rename event re-renames (echo).
    const { store, vault } = newStore()
    const created = await store.createProject('Iota', 'Projects')
    const project = await store.loadProject(fileAt(vault, created.filePath))
    expect(project).not.toBeNull()
    if (!project) return

    const rename = probe(store).renameProject
    expect(rename).toBeTypeOf('function')
    if (!rename) return
    await rename.call(store, project, 'Kappa')

    // Both new and old nested note paths are self-marked so the rename event is ignored (no echo).
    expect(store.consumeSelfWrite('Projects/Kappa/Kappa.md')).toBe(true)
    expect(store.consumeSelfWrite('Projects/Iota/Iota.md')).toBe(true)
  })

  it('R15: task folder rename tracked', async () => {
    // negative-control: after a project-file rename the tasks are orphaned or still point at the old folder.
    const { store, vault } = newStore()
    const created = await store.createProject('Eta', 'Projects')
    const project = await store.loadProject(fileAt(vault, created.filePath))
    expect(project).not.toBeNull()
    if (!project) return
    await store.insertTask(project, makeTask({ title: 'attached' }))

    await vault.rename(fileAt(vault, 'Projects/Eta/Eta.md'), 'Projects/Eta/Theta.md')

    const handle = probe(store).handleExternalRename
    expect(handle).toBeTypeOf('function')
    if (!handle) return
    await handle.call(store, 'Projects/Eta/Eta.md', fileAt(vault, 'Projects/Eta/Theta.md'))

    expect(project.tasks.length).toBe(1)
    const fp = project.tasks[0]?.filePath ?? ''
    expect(fp.startsWith('Projects/Eta/Theta_tasks/')).toBe(true)
  })
})

// ─── Feature 4 — custom calendar date picker (O5, M4) ────────────────────────

interface CalendarPickerLike {
  el: HTMLElement
  setValue: (dateStr: string) => unknown
  onChange: (cb: (dateStr: string) => void) => unknown
}

// Pinned CSS class contract (plugin classes only — never an OS/browser picker):
const CLS = {
  weekday: 'pm-calendar-picker__weekday',
  day: 'pm-calendar-picker__day',
  prev: 'pm-calendar-picker__prev',
  next: 'pm-calendar-picker__next',
  title: 'pm-calendar-picker__title'
}

/**
 * Minimal polyfill of the Obsidian HTMLElement DOM extensions the primitives
 * rely on (createEl/createDiv/setText/toggleClass/...). happy-dom supplies the
 * base DOM; Obsidian's chained helpers are patched here so the primitive can be
 * instantiated in-process. Idempotent.
 */
function patchObsidianDom(): void {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown> & { __pmPatched?: boolean }
  if (proto.__pmPatched) return
  proto.__pmPatched = true
  const applyOpts = (
    el: HTMLElement,
    o?: { cls?: string | string[]; text?: string; attr?: Record<string, string | number | boolean> }
  ): void => {
    if (!o) return
    if (o.cls) {
      const classes = Array.isArray(o.cls) ? o.cls : o.cls.split(/\s+/).filter(Boolean)
      el.classList.add(...classes)
    }
    if (o.text != null) el.textContent = o.text
    if (o.attr) for (const [k, v] of Object.entries(o.attr)) if (v != null) el.setAttribute(k, String(v))
  }
  function createEl(
    this: HTMLElement,
    tag: string,
    o?: { cls?: string | string[]; text?: string; attr?: Record<string, string | number | boolean> }
  ): HTMLElement {
    const child = doc.createElement(tag)
    applyOpts(child, o)
    this.appendChild(child)
    return child
  }
  proto.createEl = createEl
  proto.createDiv = function (this: HTMLElement, o?: { cls?: string | string[]; text?: string }): HTMLElement {
    return createEl.call(this, 'div', o)
  }
  proto.createSpan = function (this: HTMLElement, o?: { cls?: string | string[]; text?: string }): HTMLElement {
    return createEl.call(this, 'span', o)
  }
  proto.setText = function (this: HTMLElement, t: string): HTMLElement {
    this.textContent = t
    return this
  }
  proto.setAttr = function (this: HTMLElement, k: string, v: string | number | boolean | null): HTMLElement {
    if (v === null) this.removeAttribute(k)
    else this.setAttribute(k, String(v))
    return this
  }
  proto.addClass = function (this: HTMLElement, ...c: string[]): HTMLElement {
    this.classList.add(...c)
    return this
  }
  proto.removeClass = function (this: HTMLElement, ...c: string[]): HTMLElement {
    this.classList.remove(...c)
    return this
  }
  proto.toggleClass = function (this: HTMLElement, c: string | string[], on?: boolean): HTMLElement {
    for (const x of Array.isArray(c) ? c : [c]) this.classList.toggle(x, on)
    return this
  }
  proto.empty = function (this: HTMLElement): HTMLElement {
    while (this.firstChild) this.removeChild(this.firstChild)
    return this
  }
}

let CalendarPickerCtor: (new (parentEl: HTMLElement) => CalendarPickerLike) | undefined
// Source text of files that must exist / carry markers once the feature ships.
// Loaded via Vite `?raw` so the intention test needs no Node `fs` (unavailable in
// the `src/**` tsconfig scope).
let calendarSrc: string | undefined
let styleguideDoc: string | undefined
let styleguideView: string | undefined

// Runtime dynamic import: targets do not all exist until the feature is built, so
// a missing module resolves to `undefined` (a failed assertion below) rather than
// crashing collection. @vite-ignore keeps Vite from static-analyzing the paths.
async function importRaw(path: string): Promise<string | undefined> {
  try {
    // eslint-disable-next-line no-unsanitized/method -- fixed test-local path; runtime feature-detection seam
    const mod = (await import(/* @vite-ignore */ path)) as { default: string }
    return mod.default
  } catch {
    return undefined
  }
}

beforeAll(async () => {
  patchObsidianDom()
  // Variable specifier (not a literal) so tsc treats a not-yet-built module as
  // `Promise<any>` instead of an unresolved-module compile error.
  const calendarModule = './ui/primitives/CalendarPicker'
  try {
    // eslint-disable-next-line no-unsanitized/method -- fixed test-local path; runtime feature-detection seam
    const mod = (await import(/* @vite-ignore */ calendarModule)) as {
      CalendarPicker?: new (parentEl: HTMLElement) => CalendarPickerLike
    }
    CalendarPickerCtor = mod.CalendarPicker
  } catch {
    CalendarPickerCtor = undefined
  }
  calendarSrc = await importRaw('./ui/primitives/CalendarPicker.ts?raw')
  styleguideDoc = await importRaw('../docs/styleguide.md?raw')
  styleguideView = await importRaw('./views/styleguide/StyleguideView.ts?raw')
})

function mountPicker(): CalendarPickerLike {
  const root = doc.createElement('div')
  doc.body.appendChild(root)
  if (!CalendarPickerCtor) throw new Error('CalendarPicker unavailable')
  return new CalendarPickerCtor(root)
}

describe('Feature 4 — custom calendar date picker', () => {
  it('R16: calendar grid Sun-Sat rendered', () => {
    // negative-control: a Mon-first header (or any order other than Sun..Sat) must fail.
    // Pinned contract: weekday header row is exactly Sun,Mon,Tue,Wed,Thu,Fri,Sat.
    expect(CalendarPickerCtor, 'src/ui/primitives/CalendarPicker.ts must export class CalendarPicker').toBeTypeOf(
      'function'
    )
    if (!CalendarPickerCtor) return
    const picker = mountPicker()
    picker.setValue('2026-07-16')
    const heads = Array.from(picker.el.querySelectorAll<HTMLElement>(`.${CLS.weekday}`)).map((e) =>
      (e.textContent ?? '').trim()
    )
    expect(heads).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
  })

  it('R17: prev/next month navigation', () => {
    // negative-control: prev/next buttons that leave the displayed month label unchanged.
    expect(CalendarPickerCtor).toBeTypeOf('function')
    if (!CalendarPickerCtor) return
    const picker = mountPicker()
    picker.setValue('2026-07-16')
    const title = (): string => (picker.el.querySelector(`.${CLS.title}`)?.textContent ?? '').trim()
    const before = title()

    const next = picker.el.querySelector<HTMLElement>(`.${CLS.next}`)
    expect(next, 'expected a next-month button').toBeTruthy()
    if (!next) return
    next.click()
    expect(title()).not.toBe(before)

    const prev = picker.el.querySelector<HTMLElement>(`.${CLS.prev}`)
    expect(prev, 'expected a prev-month button').toBeTruthy()
    if (!prev) return
    prev.click()
    expect(title()).toBe(before)
  })

  it('R18: picking day sets date', () => {
    // negative-control: onChange payload like '2026-7-20' or a Date object (not the pinned string shape).
    // Pinned contract: onChange receives a string matching ^\d{4}-\d{2}-\d{2}$ equal to the clicked day.
    expect(CalendarPickerCtor).toBeTypeOf('function')
    if (!CalendarPickerCtor) return
    const picker = mountPicker()
    let received: string | undefined
    picker.onChange((d) => {
      received = d
    })
    picker.setValue('2026-07-16')

    const cells = Array.from(picker.el.querySelectorAll<HTMLElement>(`.${CLS.day}`))
    const cell = cells.find(
      (c) => (c.textContent ?? '').trim() === '20' && !/adjacent|other|outside|muted/.test(c.className)
    )
    expect(cell, 'expected a clickable day cell for the 20th of the displayed month').toBeTruthy()
    if (!cell) return
    cell.click()

    expect(received).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(received).toBe('2026-07-20')
  })

  it('R19: plugin CSS classes only', () => {
    // negative-control: a source line like `el.style.left = '0'` (inline style) must fail.
    expect(calendarSrc, 'src/ui/primitives/CalendarPicker.ts must exist').toBeTypeOf('string')
    if (!calendarSrc) return
    expect(calendarSrc).not.toMatch(/\.style\s*[.[]/)
  })

  it('R20: styleguide catalog updated', () => {
    // negative-control: primitive shipped but never cataloged in the styleguide doc or gallery view.
    expect(styleguideDoc, 'docs/styleguide.md must be readable').toBeTypeOf('string')
    expect(styleguideView, 'src/views/styleguide/StyleguideView.ts must be readable').toBeTypeOf('string')
    if (!styleguideDoc || !styleguideView) return
    expect(styleguideDoc).toContain('CalendarPicker')
    expect(styleguideView).toContain('CalendarPicker')
  })

  // R21 (dates stay YYYY-MM-DD strings) is UNTESTED by design: it is already
  // proven by R18's pinned ^\d{4}-\d{2}-\d{2}$ onChange contract. See worksheet R18/R21.
  it.skip('R21: dates stay YYYY-MM-DD strings', () => {})
})

// ─── Feature 5 — self-describing status palettes (INT-017, O6, M5) ───────────
//
// Project markdown must self-describe its legal status/priority vocabulary so an
// AI reading only the file knows the allowed values. On every project save the
// store materializes the RESOLVED palette (statuses + priorities via the
// configFor fallback chain) into the project frontmatter `config.statuses` /
// `config.priorities`, tagged `config.materialized: true`. That marker is the
// round-trip-safety mechanic: a materialized block is informational (the
// resolver ignores it and re-derives from the global palette, so later global
// edits re-propagate), while a genuine user override (no `materialized: true`)
// still wins through configFor unchanged. Ingestion validates an incoming
// status/priority against the effective palette: blank → default (R4),
// case-mismatch of a known id → canonical id, unknown value → preserved.

/** Ids of the objects in `config.<key>` on a project's on-disk frontmatter. */
function paletteIds(fm: Record<string, unknown>, key: 'statuses' | 'priorities'): string[] {
  const cfg = fm.config as Record<string, unknown> | undefined
  const list = cfg?.[key]
  return Array.isArray(list) ? list.map((e) => String((e as { id?: unknown }).id)) : []
}

/** The `config.materialized` marker on a project's on-disk frontmatter, if any. */
function materializedFlag(fm: Record<string, unknown>): unknown {
  return (fm.config as Record<string, unknown> | undefined)?.materialized
}

describe('Feature 5: self-describing status palettes', () => {
  it('R22: resolved palette materialized into project frontmatter on save', async () => {
    // negative-control: project saved but frontmatter still lacks config.statuses.
    const { store, vault } = newStore()
    const project = await store.createProject('Palette Home', 'Projects')

    // Effective palette = the configFor fallback chain (global settings here).
    const effectiveStatuses = store.configFor(project).statuses.map((s) => s.id)
    const effectivePriorities = store.configFor(project).priorities.map((p) => p.id)

    // Forensic: the on-disk frontmatter now carries the resolved palette.
    const disk = await frontmatterOf(vault, project.filePath)
    expect(paletteIds(disk, 'statuses'), 'config.statuses must materialize the effective status ids').toEqual(
      expect.arrayContaining(effectiveStatuses)
    )
    expect(paletteIds(disk, 'priorities')).toEqual(expect.arrayContaining(effectivePriorities))
    // Round-trip-safety marker: a materialized block is tagged so the resolver
    // does not misread it as a deliberate override.
    expect(materializedFlag(disk)).toBe(true)
  })

  it('R23: legacy project (no config block) gains the materialized palette on first save', async () => {
    // negative-control: legacy file stays bare (no config) after save.
    const { store, vault } = newStore()
    await vault.create(
      'Projects/Legacy Palette.md',
      taskFileBody([
        '---',
        'pm-project: true',
        'id: legacy-pal-1',
        'title: Legacy Palette',
        'taskIds: []',
        '---',
        '',
        'body'
      ])
    )
    const project = await store.loadProject(fileAt(vault, 'Projects/Legacy Palette.md'))
    expect(project).not.toBeNull()
    if (!project) return

    // Precondition: the legacy file has no config block yet.
    const bare = await frontmatterOf(vault, project.filePath)
    expect(bare.config, 'legacy fixture must start without a config block').toBeUndefined()

    const effectiveStatuses = store.configFor(project).statuses.map((s) => s.id)
    await store.saveProject(project)

    // Forensic: the first save backfills the resolved palette into the bare file.
    const disk = await frontmatterOf(vault, project.filePath)
    expect(paletteIds(disk, 'statuses'), 'first save must backfill config.statuses').toEqual(
      expect.arrayContaining(effectiveStatuses)
    )
    expect(materializedFlag(disk)).toBe(true)
  })

  it('R24: ingestion normalizes case-mismatched status id, preserves unknown values', async () => {
    // negative-control: 'Todo' left unnormalized, or unknown 'blocked-ish' destroyed.
    const { store, vault } = newStore()
    const project = await store.createProject('Inbox', 'Projects')

    const ingest = probe(store).ingestExternalTask
    expect(ingest, 'ProjectStore.ingestExternalTask must exist').toBeTypeOf('function')
    if (!ingest) return

    // Case-mismatch of the known id 'todo' → normalized to the canonical id.
    const casePath = 'Projects/Inbox/Inbox_tasks/case-mismatch.md'
    await vault.create(
      casePath,
      taskFileBody(['---', 'pm-task: true', 'title: Case', 'status: Todo', '---', '', 'body'])
    )
    const cased = await ingest.call(store, project, fileAt(vault, casePath))
    expect(cased).not.toBeNull()
    if (!cased) return
    expect(cased.status, "case-mismatched 'Todo' must normalize to canonical 'todo'").toBe('todo')

    // Unknown value → PRESERVED (never destroy AI/user data); the task still loads.
    const unknownPath = 'Projects/Inbox/Inbox_tasks/unknown-status.md'
    await vault.create(
      unknownPath,
      taskFileBody(['---', 'pm-task: true', 'title: Unknown', 'status: blocked-ish', '---', '', 'body'])
    )
    const unknown = await ingest.call(store, project, fileAt(vault, unknownPath))
    expect(unknown, 'a task with an unknown status must still load').not.toBeNull()
    if (!unknown) return
    expect(unknown.status, "unknown 'blocked-ish' must be preserved, not destroyed").toBe('blocked-ish')
  })

  it('R25: explicit per-project override still wins through configFor after materialization', async () => {
    // negative-control (regression): override clobbered by the global palette on save.
    const { app, vault } = makeFakeApp()
    const localSettings: PMSettings = { ...DEFAULT_SETTINGS }
    const store = new ProjectStore(app as unknown as App, () => localSettings)

    // A genuine user override: a single custom status, and NO materialized marker.
    await vault.create(
      'Projects/Override.md',
      taskFileBody([
        '---',
        'pm-project: true',
        'id: override-1',
        'title: Override',
        'taskIds: []',
        'config:',
        '  statuses:',
        '    - id: custom',
        '      label: Custom',
        '      color: "#123456"',
        '      icon: ""',
        '      complete: false',
        '---',
        '',
        'body'
      ])
    )
    const project = await store.loadProject(fileAt(vault, 'Projects/Override.md'))
    expect(project).not.toBeNull()
    if (!project) return

    // Baseline: the override wins through configFor (global ids absent).
    const before = store.configFor(project).statuses.map((s) => s.id)
    expect(before, 'override must win before materialization').toContain('custom')
    expect(before, 'global-only ids must not leak into an overridden palette').not.toContain('in-progress')

    // Materialize via a save, then reload from disk.
    await store.saveProject(project)
    const reloaded = await store.loadProject(fileAt(vault, 'Projects/Override.md'))
    expect(reloaded).not.toBeNull()
    if (!reloaded) return

    // Regression: the override still wins through configFor after the round-trip.
    const after = store.configFor(reloaded).statuses.map((s) => s.id)
    expect(after, 'override must still win through configFor after materialization').toContain('custom')
    expect(after, 'materialization must not clobber the override with the global palette').not.toContain('in-progress')

    // Forensic: the override block is NOT re-tagged as materialized (so it stays
    // a deliberate override on the next round-trip).
    const disk = await frontmatterOf(vault, reloaded.filePath)
    expect(paletteIds(disk, 'statuses'), 'on-disk override must survive the save').toEqual(['custom'])
    expect(materializedFlag(disk), 'a genuine override must not be flagged materialized').not.toBe(true)
  })
})

// ─── Feature 6 — agent-authored ID authority (INT-018, O7, M6) ───────────────
//
// An AI agent can author a whole project — milestones, subtasks, dependencies —
// directly as Markdown files with its OWN stable ids. Three cold-FOLDER-LOAD
// gaps make that unsafe today (the live create/modify ingest path already mints,
// but a project opened cold does not): (1) a blank/absent `id` is loaded as
// undefined/'' instead of a minted, persisted id; (2) two files that share an id
// silently last-wins in the task map (data loss); (3) an arbitrary id string is
// used verbatim even though ids flow into slugs/filenames. INT-018 hardens the
// load path so every task gets a stable, safe, unique id — minted/re-minted and
// persisted back to disk (processFrontMatter + markSelfWrite) — without changing
// association (still folder-based), the minted format, or forcing any id scheme.
//
// These requirements probe the COLD load path (`store.loadProject` on an on-disk
// fixture), NOT the live-event `ingestExternalTask` path exercised by Feature 1.
// `loadProject` already exists, so calling it never crashes — the RED failures
// below are assertion failures against behavior that does not exist yet.
//
// Pinned id-validity rule (routing/WS contract): an id is VALID iff it matches
//   ^[A-Za-z0-9._-]{1,64}$
// (safe slug/filename charset, non-empty, at most 64 chars). An id that violates
// this — path separators (`/`, `\`), whitespace, other punctuation, or length
// > 64 — is treated exactly like a collision: normalized or re-minted, persisted,
// and warned. A blank/absent id is minted. The kept-first / re-mint-collider
// policy resolves duplicates without dropping data.

/** A safe id must be usable verbatim as a slug/filename segment. */
const ID_RULE = /^[A-Za-z0-9._-]{1,64}$/

/** Depth-first flatten of a task tree (top-level + all descendants). */
function flattenTree(tasks: Task[]): Task[] {
  const out: Task[] = []
  const walk = (list: Task[]): void => {
    for (const t of list) {
      out.push(t)
      if (t.subtasks.length) walk(t.subtasks)
    }
  }
  walk(tasks)
  return out
}

/** Create a project .md + its `<Name>_tasks` folder marker on disk (no store call). */
async function seedProjectFile(
  vault: FakeVault,
  dir: string,
  name: string,
  frontmatterLines: string[]
): Promise<string> {
  const projectPath = `${dir}/${name}.md`
  await vault.create(projectPath, taskFileBody(['---', 'pm-project: true', ...frontmatterLines, '---', '', 'body']))
  await vault.createFolder(`${dir}/${name}_tasks`)
  return projectPath
}

describe('Feature 6 — agent-authored ID authority', () => {
  it('R29: blank id minted and persisted on cold folder-load', async () => {
    // negative-control (today's bug): a cold-loaded task with a blank/absent id
    // stays undefined/'' in memory AND on disk — no id is minted or persisted, so
    // the task cannot be stably referenced across reloads.
    const { store, vault } = newStore()
    const projectPath = await seedProjectFile(vault, 'Projects', 'Authored', [
      'id: authored-1',
      'title: Authored',
      'taskIds: []'
    ])
    // Agent-authored task file with NO `id` key at all.
    const taskPath = 'Projects/Authored_tasks/no-id.md'
    await vault.create(taskPath, taskFileBody(['---', 'pm-task: true', 'title: Needs an id', '---', '', 'body']))

    const project = await store.loadProject(fileAt(vault, projectPath))
    expect(project).not.toBeNull()
    if (!project) return

    // The task loads (never dropped), located by its title since it has no id yet.
    const loaded = flattenTree(project.tasks).find((t) => t.title === 'Needs an id')
    expect(loaded, 'a blank-id task must still load').toBeDefined()
    if (!loaded) return
    // In-memory: a minted, non-empty id.
    expect(typeof loaded.id).toBe('string')
    expect(typeof loaded.id === 'string' ? loaded.id.length : 0).toBeGreaterThan(0)

    // Forensic: the mint is persisted back into the file's frontmatter on disk.
    const fm = await frontmatterOf(vault, taskPath)
    expect(typeof fm.id, 'the minted id must be written back to disk').toBe('string')
    expect(typeof fm.id === 'string' ? fm.id.length : 0).toBeGreaterThan(0)

    // The backfill write must be self-marked so the resulting modify event is not
    // re-ingested (no echo), exactly like the live ingest path (R7).
    expect(store.consumeSelfWrite(taskPath)).toBe(true)
  })

  it('R30: duplicate ids both survive — collider re-minted, no silent drop', async () => {
    // negative-control (today's bug): the second file's id silently overwrites the
    // first in the task map (last-wins), so one task is dropped — data loss.
    const { store, vault } = newStore()
    const projectPath = await seedProjectFile(vault, 'Projects', 'Dupes', [
      'id: dupes-1',
      'title: Dupes',
      'taskIds:',
      '  - dup-1'
    ])
    const aPath = 'Projects/Dupes_tasks/a.md'
    const bPath = 'Projects/Dupes_tasks/b.md'
    await vault.create(aPath, taskFileBody(['---', 'pm-task: true', 'id: dup-1', 'title: First', '---', '', 'body']))
    await vault.create(bPath, taskFileBody(['---', 'pm-task: true', 'id: dup-1', 'title: Second', '---', '', 'body']))

    const project = await store.loadProject(fileAt(vault, projectPath))
    expect(project).not.toBeNull()
    if (!project) return

    // Both agent-authored tasks must be present after load — neither dropped.
    const all = flattenTree(project.tasks)
    const first = all.find((t) => t.title === 'First')
    const second = all.find((t) => t.title === 'Second')
    expect(first, 'the first colliding task must not be silently dropped').toBeDefined()
    expect(second, 'the second colliding task must not be silently dropped').toBeDefined()
    if (!first || !second) return

    // The collision is resolved by re-minting one of them to a distinct id.
    expect(first.id, 'colliding ids must be made distinct').not.toBe(second.id)
    // Keep-first policy: exactly one survivor retains the original id.
    expect([first.id, second.id].filter((id) => id === 'dup-1').length).toBe(1)

    // Forensic: the re-mint is persisted — the two files carry distinct, non-empty
    // ids on disk (not both still 'dup-1').
    const fmA = await frontmatterOf(vault, aPath)
    const fmB = await frontmatterOf(vault, bPath)
    expect(String(fmA.id), 'a.md must keep a non-empty id on disk').not.toBe('')
    expect(String(fmB.id), 'b.md must keep a non-empty id on disk').not.toBe('')
    expect(fmA.id, 'the persisted ids must be de-duplicated on disk').not.toBe(fmB.id)
  })

  it('R31: minting a nested child preserves its parent nesting', async () => {
    // negative-control (today's bug): a parentId-referenced child with a blank id
    // loads under its parent but keeps an undefined/'' id (not minted, not
    // persisted), so the agent-authored nesting has no stable ids across reloads;
    // a naive re-key on mint could also detach the child from its parent.
    const { store, vault } = newStore()
    const projectPath = await seedProjectFile(vault, 'Projects', 'Nested', [
      'id: nested-1',
      'title: Nested',
      'taskIds:',
      '  - ms-1'
    ])
    const parentPath = 'Projects/Nested_tasks/parent.md'
    const childPath = 'Projects/Nested_tasks/child.md'
    // Parent authored with a stable id; child references it via parentId but has
    // NO id of its own (left for the plugin to mint).
    await vault.create(
      parentPath,
      taskFileBody(['---', 'pm-task: true', 'id: ms-1', 'title: Milestone', '---', '', 'body'])
    )
    await vault.create(
      childPath,
      taskFileBody(['---', 'pm-task: true', 'parentId: ms-1', 'title: Subtask', '---', '', 'body'])
    )

    const project = await store.loadProject(fileAt(vault, projectPath))
    expect(project).not.toBeNull()
    if (!project) return

    // Nesting: the child appears UNDER the parent (agent-authored parentId honored).
    const parent = project.tasks.find((t) => t.title === 'Milestone')
    expect(parent, 'the parent milestone must load').toBeDefined()
    if (!parent) return
    expect(parent.id, 'an explicit parent id must be preserved verbatim').toBe('ms-1')
    const child = parent.subtasks.find((s) => s.title === 'Subtask')
    expect(child, 'the child must remain nested under its parent after id minting').toBeDefined()
    if (!child) return

    // The nested child's blank id is minted (in memory + on disk) so the structure
    // has stable ids across reloads.
    expect(typeof child.id).toBe('string')
    expect(typeof child.id === 'string' ? child.id.length : 0).toBeGreaterThan(0)
    const childFm = await frontmatterOf(vault, childPath)
    expect(typeof childFm.id === 'string' ? childFm.id.length : 0).toBeGreaterThan(0)
    // The nesting is durable: the child's persisted parentId still points at the parent.
    expect(childFm.parentId, 'the persisted parentId must still resolve to the parent').toBe('ms-1')
  })

  it('R32: invalid/oversized ids are normalized, never used verbatim, load never crashes', async () => {
    // negative-control (today's bug): the raw invalid id is used as-is — a path
    // separator leaks into the slug/filename, and an oversized id is left untrimmed.
    const { store, vault } = newStore()
    const projectPath = await seedProjectFile(vault, 'Projects', 'Ids', ['id: ids-1', 'title: Ids', 'taskIds: []'])
    // (a) an id containing a path separator — a direct slug/filename hazard.
    const sepPath = 'Projects/Ids_tasks/sep.md'
    await vault.create(
      sepPath,
      taskFileBody(['---', 'pm-task: true', 'id: epic/frontend', 'title: Path Sep', '---', '', 'body'])
    )
    // (b) an oversized id (> 64 chars) that violates the length cap.
    const bigId = 'x'.repeat(300)
    const bigPath = 'Projects/Ids_tasks/big.md'
    await vault.create(
      bigPath,
      taskFileBody(['---', 'pm-task: true', `id: ${bigId}`, 'title: Oversized', '---', '', 'body'])
    )

    // Load must not crash on invalid ids.
    const project = await store.loadProject(fileAt(vault, projectPath))
    expect(project).not.toBeNull()
    if (!project) return

    const all = flattenTree(project.tasks)
    const sep = all.find((t) => t.title === 'Path Sep')
    const big = all.find((t) => t.title === 'Oversized')
    expect(sep, 'a task with a path-separator id must still load').toBeDefined()
    expect(big, 'a task with an oversized id must still load').toBeDefined()
    if (!sep || !big) return

    // The invalid ids are normalized/re-minted to the safe rule — never verbatim.
    expect(sep.id, 'a path-separator id must not be used verbatim as a slug/filename').not.toContain('/')
    expect(sep.id).not.toContain('\\')
    expect(sep.id, 'the resolved id must satisfy the pinned id rule').toMatch(ID_RULE)
    expect(big.id.length, 'an oversized id must be capped to the pinned max length').toBeLessThanOrEqual(64)
    expect(big.id, 'the resolved id must satisfy the pinned id rule').toMatch(ID_RULE)

    // Forensic: the safe ids are persisted back to disk (not left verbatim).
    const sepFm = await frontmatterOf(vault, sepPath)
    expect(String(sepFm.id), 'the path-separator id must be rewritten safely on disk').not.toContain('/')
    const bigFm = await frontmatterOf(vault, bigPath)
    expect(String(bigFm.id).length, 'the oversized id must be trimmed on disk').toBeLessThanOrEqual(64)
  })
})

// ─── Feature 7 — project-folder restructure + migration (INT-020, O8, M7) ────
//
// Every project now lives in ITS OWN folder so the folder is free for the user's
// (or an AI's) free-form content. The layout changes from the old flat form —
//   <path>/<Name>.md              (project note)
//   <path>/<Name>_tasks/          (tasks, a SIBLING of the note)
// to the new nested form —
//   <path>/<Name>/                (the per-project folder — free for freeform content)
//   <path>/<Name>/<Name>.md       (the project note, inside its folder)
//   <path>/<Name>/<Name>_tasks/   (the tasks folder, moved one level DOWN, name unchanged)
//
// Pinned `path` contract (routing/WS): the `path` frontmatter key keeps its
// INT-014 meaning — the vault-relative directory the project is FILED UNDER, i.e.
// the directory that CONTAINS the per-project folder. So for `path: <dir>` and a
// project titled `<Name>`, the folder is `<dir>/<Name>/`, the note is
// `<dir>/<Name>/<Name>.md`, and the tasks are `<dir>/<Name>/<Name>_tasks/`.
// `projectDirectory(project)` still resolves to `<dir>` (unchanged from INT-014
// R8/R10/R11 — the `_tasks` folder name is NOT renamed, it only moves down one
// level). Blank/absent `path` falls back to the directory that contains the
// per-project folder (consistent with the INT-014 parent-folder fallback).
//
// Migration is idempotent and runs on load: a legacy flat-layout project
// (`<dir>/<Name>.md` + sibling `<dir>/<Name>_tasks/`) is relocated into the new
// nested layout via vault rename (so Obsidian updates links), preserving the
// project-note body, task association, and any existing content; a project
// already in the nested layout is left untouched (no-op).
//
// These requirements drive `store.createProject`, `store.discoverProjects` (the
// on-load migration entrypoint), and `store.moveProject` — all of which already
// exist, so the RED failures below are ASSERTION failures against the not-yet-
// existent nested layout, never crashes.

describe('Feature 7 — project-folder restructure', () => {
  it('R33: createProject produces the nested per-project-folder layout', async () => {
    // negative-control: files created in the OLD flat layout — the note at
    // `<dir>/<Name>.md` with a SIBLING `<dir>/<Name>_tasks/`, leaving no
    // per-project folder for the user's free-form content.
    const { store, vault } = newStore()
    const project = await store.createProject('Nested Home', 'Areas/Ops')

    // Forensic: the project note + its `<Name>_tasks` folder both live INSIDE the
    // new per-project folder `Areas/Ops/Nested Home/`.
    expect(
      vault.getAbstractFileByPath('Areas/Ops/Nested Home/Nested Home.md'),
      'the project note must live inside its own per-project folder'
    ).toBeInstanceOf(TFile)
    expect(
      vault.getAbstractFileByPath('Areas/Ops/Nested Home/Nested Home_tasks'),
      'the tasks folder must be nested one level down, inside the per-project folder'
    ).toBeInstanceOf(TFolder)

    // The note must NOT be written in the old flat layout.
    expect(
      vault.getAbstractFileByPath('Areas/Ops/Nested Home.md'),
      'the project note must not be written in the old flat layout'
    ).toBeNull()

    // The `path` frontmatter keeps its INT-014 meaning: the directory the project
    // is filed under (which CONTAINS the per-project folder), and
    // `projectDirectory` resolves to it.
    const fm = await frontmatterOf(vault, project.filePath)
    expect(fm.path, 'path frontmatter is the directory containing the per-project folder').toBe('Areas/Ops')
    const directoryOf = probe(store).projectDirectory
    expect(directoryOf).toBeTypeOf('function')
    if (!directoryOf) return
    expect(directoryOf.call(store, project)).toBe('Areas/Ops')
  })

  it('R34: a legacy flat-layout project is migrated to the nested layout on load', async () => {
    // negative-control: the legacy project is left un-migrated (note + sibling
    // tasks folder stay at the old flat paths), or its tasks / project-note body
    // are lost during the move.
    const { store, vault } = newStore()
    // Seed a legacy flat-layout project: note with a free-form body + one task in
    // the SIBLING `_tasks` folder.
    await vault.create(
      'Projects/Legacy Proj.md',
      taskFileBody([
        '---',
        'pm-project: true',
        'id: legacy-proj-1',
        'title: Legacy Proj',
        'path: Projects',
        'taskIds:',
        '  - lt-1',
        '---',
        '',
        'Freeform project body kept across the migration.'
      ])
    )
    await vault.createFolder('Projects/Legacy Proj_tasks')
    await vault.create(
      'Projects/Legacy Proj_tasks/lt-1.md',
      taskFileBody(['---', 'pm-task: true', 'id: lt-1', 'title: Legacy Task', '---', '', 'task body'])
    )

    // Migration runs on load: discovery is the vault-wide load entrypoint.
    const discover = probe(store).discoverProjects
    expect(discover, 'ProjectStore.discoverProjects() must exist').toBeTypeOf('function')
    if (!discover) return
    await discover.call(store)

    // Forensic: the project note + its task file now live in the NESTED layout,
    // and nothing remains at the old flat locations.
    const migratedNote = vault.getAbstractFileByPath('Projects/Legacy Proj/Legacy Proj.md')
    expect(migratedNote, 'the project note must be relocated into its own per-project folder').toBeInstanceOf(TFile)
    expect(
      vault.getAbstractFileByPath('Projects/Legacy Proj/Legacy Proj_tasks/lt-1.md'),
      'the task file must move with the project into the nested `_tasks` folder'
    ).toBeInstanceOf(TFile)
    expect(
      vault.getAbstractFileByPath('Projects/Legacy Proj.md'),
      'nothing must remain at the old flat note path'
    ).toBeNull()
    expect(
      vault.getAbstractFileByPath('Projects/Legacy Proj_tasks'),
      'nothing must remain at the old flat sibling tasks folder'
    ).toBeNull()

    // The migration is content-preserving: the project-note body and the task
    // association survive. (Early-return guard so a missing file fails the
    // instanceof assertion above rather than crashing the read below.)
    if (!(migratedNote instanceof TFile)) return
    const noteContent = await vault.cachedRead(migratedNote)
    expect(noteContent, 'the project-note body must be preserved across the migration').toContain(
      'Freeform project body kept across the migration.'
    )
    const fm = parseFrontmatter(noteContent).frontmatter ?? {}
    const taskIds = Array.isArray(fm.taskIds) ? (fm.taskIds as unknown[]).map(String) : []
    expect(taskIds, 'the task association (taskIds ordering) must be preserved').toContain('lt-1')
  })

  it('R35: tasks still associate (folder-based) after the restructure', async () => {
    // negative-control: tasks are lost because path-matching still expects the old
    // SIBLING `<dir>/<Name>_tasks/` location instead of the nested one.
    const { store, vault } = newStore()
    await vault.create(
      'Projects/Assoc Proj.md',
      taskFileBody([
        '---',
        'pm-project: true',
        'id: assoc-proj-1',
        'title: Assoc Proj',
        'path: Projects',
        'taskIds:',
        '  - at-1',
        '---',
        '',
        'body'
      ])
    )
    await vault.createFolder('Projects/Assoc Proj_tasks')
    await vault.create(
      'Projects/Assoc Proj_tasks/at-1.md',
      taskFileBody(['---', 'pm-task: true', 'id: at-1', 'title: Assoc Task', '---', '', 'task body'])
    )

    const discover = probe(store).discoverProjects
    expect(discover).toBeTypeOf('function')
    if (!discover) return
    const found = await discover.call(store)

    // The migrated project is discovered, and its task loads into the tree —
    // folder-based association survived the restructure.
    const proj = found.find((p) => p.title === 'Assoc Proj')
    expect(proj, 'the migrated project must be discovered').toBeDefined()
    if (!proj) return
    const task = findTask(proj.tasks, 'at-1')
    expect(task, 'the task must still associate with its project after the restructure').toBeDefined()

    // And it resolves against the NESTED `_tasks` folder, not the old sibling one.
    expect(task?.filePath ?? '', 'the task must resolve under the nested `_tasks` folder').toMatch(
      /^Projects\/Assoc Proj\/Assoc Proj_tasks\//
    )
    // Forensic on disk: the task file physically lives under the nested folder.
    expect(
      vault.getAbstractFileByPath('Projects/Assoc Proj/Assoc Proj_tasks/at-1.md'),
      'the task file must be relocated under the nested tasks folder'
    ).toBeInstanceOf(TFile)
  })

  it('R36: moveProject moves the entire project folder (note + tasks + freeform content)', async () => {
    // negative-control: only the note (and maybe the tasks folder) moves, leaving
    // the per-project folder's free-form content behind at the old location.
    const { store, vault } = newStore()
    const created = await store.createProject('Movable', 'Projects')
    const project = await store.loadProject(fileAt(vault, created.filePath))
    expect(project).not.toBeNull()
    if (!project) return
    await store.insertTask(project, makeTask({ title: 'line item' }))

    // Free-form content the user (or an AI) dropped INTO the per-project folder.
    await vault.create('Projects/Movable/reference.md', taskFileBody(['# Reference', 'user free-form content']))

    const move = probe(store).moveProject
    expect(move, 'ProjectStore.moveProject(project, newDir) must exist').toBeTypeOf('function')
    if (!move) return
    await move.call(store, project, 'Areas/Portfolio')

    // Forensic: the WHOLE per-project folder relocated under the new directory —
    // the note, the `_tasks` folder, AND the free-form content.
    expect(
      vault.getAbstractFileByPath('Areas/Portfolio/Movable/Movable.md'),
      'the project note must move with its per-project folder'
    ).toBeInstanceOf(TFile)
    expect(
      vault.getAbstractFileByPath('Areas/Portfolio/Movable/Movable_tasks'),
      'the nested tasks folder must move with the per-project folder'
    ).toBeInstanceOf(TFolder)
    expect(
      vault.getAbstractFileByPath('Areas/Portfolio/Movable/reference.md'),
      'the free-form content inside the per-project folder must move too'
    ).toBeInstanceOf(TFile)

    // Nothing left behind at the old per-project folder.
    expect(vault.getAbstractFileByPath('Projects/Movable/Movable.md')).toBeNull()
    expect(vault.getAbstractFileByPath('Projects/Movable/reference.md')).toBeNull()

    // The task moved with the folder (not orphaned at the old path).
    const movedTaskPath = project.tasks[0]?.filePath ?? ''
    expect(movedTaskPath.startsWith('Areas/Portfolio/Movable/Movable_tasks/')).toBe(true)

    // The persisted `path` frontmatter + resolved directory track the new dir.
    const fm = await frontmatterOf(vault, project.filePath)
    expect(fm.path).toBe('Areas/Portfolio')
    const directoryOf = probe(store).projectDirectory
    expect(directoryOf).toBeTypeOf('function')
    if (!directoryOf) return
    expect(directoryOf.call(store, project)).toBe('Areas/Portfolio')
  })
})

// ─── Feature 8 — parent backlinks in body + content detection (INT-021, O9, M8) ─
//
// Two coupled, additive, always-on capabilities so a human and an AI agent can
// co-manage projects as a connected Obsidian graph of plain notes:
//
// 1. PARENT BACKLINKS IN BODY. On create, the store writes a LIVE Obsidian
//    `[[wikilink]]` to the item's IMMEDIATE parent into the note BODY — a task
//    links its milestone / parent task / project; a milestone links its project /
//    parent milestone. This is IN ADDITION to the existing frontmatter parent refs
//    (`parentId` / `projectId`) — additive, never replacing, cannot be disabled —
//    so the user's graph view shows projects/tasks as connected notes. The link is
//    written on a recognizable line carrying a SENTINEL so the content detector can
//    exclude it while the `[[link]]` stays plainly visible and graph-indexable.
//
// 2. CONTENT-AWARE DETECTION (the "has real content" signal the CLI's `✎N` symbol
//    uses). A store-level helper reports whether a note has real body content
//    BEYOND its frontmatter AND beyond the managed auto-link line(s), plus a
//    line-count size hint. The managed auto-link must NOT count as content, else
//    every managed note lights up and the signal is useless.
//
// Pinned mechanism (routing/WS contract): the managed backlink is written on a
// line ending in the SENTINEL `<!-- pm:link -->` (e.g. `Part of [[<Parent>]]
// <!-- pm:link -->`) at the top of the body. Detection strips the frontmatter and
// any `<!-- pm:link -->`-marked line(s), then inspects the remainder:
//   - hasBodyContent(file)  → true iff a non-blank line survives that stripping.
//   - bodyContentLines(file) → the count of non-blank lines that survive it
//     (frontmatter + managed link line(s) excluded).
// Build-time note flagged to the implementer: verify the HTML-comment sentinel
// does NOT suppress Obsidian graph indexing of the `[[link]]`; if it does, move
// the marker rather than wrap the link.
//
// These requirements drive `store.createProject` / `store.insertTask` (which
// already exist, so RED failures are ASSERTION failures against the not-yet-
// written sentinel-marked backlink, never crashes) and probe two new optional
// store surfaces (`hasBodyContent` / `bodyContentLines`), feature-detected with
// `toBeTypeOf('function')` so their absence fails an assertion rather than
// crashing.

/** The sentinel that marks the store-managed backlink line so detection can exclude it. */
const LINK_SENTINEL = '<!-- pm:link -->'

/** The note body (frontmatter stripped) at a given vault path. */
async function bodyOf(vault: FakeVault, path: string): Promise<string> {
  const content = await vault.cachedRead(fileAt(vault, path))
  return parseFrontmatter(content).body
}

/** The basename (no directory, no `.md`) a wikilink would target for a file path. */
function basenameOf(filePath: string | undefined): string {
  return (filePath ?? '').replace(/^.*\//, '').replace(/\.md$/, '')
}

/** The first body line carrying the managed-link sentinel, or undefined if none. */
function managedLinkLine(body: string): string | undefined {
  return body.split('\n').find((l) => l.includes(LINK_SENTINEL))
}

/** The `[[target]]` / `[[target|alias]]` targets on a single line (alias stripped). */
function wikilinkTargets(line: string): string[] {
  const out: string[] = []
  const re = /\[\[([^\]]+)\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) out.push((m[1].split('|')[0] ?? '').trim())
  return out
}

describe('Feature 8 — parent backlinks + content detection', () => {
  it('R37: creating a task under a milestone writes a sentinel-marked live backlink to the parent, additive to frontmatter', async () => {
    // negative-control: NO body link is written — only the frontmatter `parentId`
    // carries the parent ref, so the user's Obsidian graph shows the task as an
    // unconnected orphan note (the whole point of the feature is a live [[link]]).
    const { store, vault } = newStore()
    const project = await store.createProject('Roadmap', 'Projects')
    const milestone = makeTask({ title: 'Launch Milestone', type: 'milestone' })
    await store.insertTask(project, milestone)
    const child = makeTask({ title: 'Write the copy' })
    await store.insertTask(project, child, milestone.id)

    // The frontmatter parent ref is unchanged — the body link is ADDITIVE, not a
    // replacement.
    const childPath = child.filePath
    expect(childPath, 'the inserted task must have a persisted file path').toBeTruthy()
    if (!childPath) return
    const fm = await frontmatterOf(vault, childPath)
    expect(fm.parentId, 'the frontmatter parent ref must stay — the body backlink is additive').toBe(milestone.id)

    // Forensic: the body carries a sentinel-marked managed backlink whose live
    // [[wikilink]] targets the IMMEDIATE parent (the milestone).
    const line = managedLinkLine(await bodyOf(vault, childPath))
    expect(line, `the task body must carry a managed backlink line marked with ${LINK_SENTINEL}`).toBeTruthy()
    if (!line) return
    expect(
      wikilinkTargets(line),
      'the managed backlink must be a live [[wikilink]] to the immediate parent milestone'
    ).toContain(basenameOf(milestone.filePath))
  })

  it('R38: the content-detector excludes the managed auto-link — a note that is only the backlink reads as no real content; real prose flips it true', async () => {
    // negative-control: the managed auto-link is COUNTED as content, so every
    // freshly-created managed note reads as "has content" and the CLI's ✎ signal
    // becomes useless noise (a bare note lights up).
    const { store, vault } = newStore()
    const project = await store.createProject('Detect', 'Projects')
    // No description → the body is only the managed backlink line.
    const task = makeTask({ title: 'Bare task' })
    await store.insertTask(project, task)
    expect(task.filePath, 'the inserted task must have a persisted file path').toBeTruthy()
    if (!task.filePath) return

    const hasContent = probe(store).hasBodyContent
    expect(hasContent, 'ProjectStore.hasBodyContent(file) must exist').toBeTypeOf('function')
    if (!hasContent) return

    const file = fileAt(vault, task.filePath)
    expect(
      await hasContent.call(store, file),
      'a note whose body is only the managed backlink has NO real content'
    ).toBe(false)

    // Add real prose the user/agent wrote; the detector must now report content.
    await vault.process(file, (c) => `${c}\n\nThis is a real note the user wrote.\n`)
    expect(await hasContent.call(store, file), 'once real prose is added the detector must report content').toBe(true)
  })

  it('R39: the size hint counts only real content lines — frontmatter and the managed link line are excluded', async () => {
    // negative-control: the managed link line (and/or the frontmatter) inflates the
    // count, so the ✎N size hint overstates how much the note actually holds.
    const { store, vault } = newStore()
    await store.createProject('Sizer', 'Projects')

    // Hand-authored note: frontmatter + a sentinel-marked managed link + exactly
    // three real prose lines. Authored directly so the fixture is unambiguous.
    const path = 'Projects/Sizer_tasks/sized.md'
    await vault.create(
      path,
      taskFileBody([
        '---',
        'pm-task: true',
        'id: sized-1',
        'title: Sized',
        '---',
        '',
        `Part of [[Sizer]] ${LINK_SENTINEL}`,
        '',
        'First real line.',
        'Second real line.',
        'Third real line.'
      ])
    )

    const countLines = probe(store).bodyContentLines
    expect(countLines, 'ProjectStore.bodyContentLines(file) must exist').toBeTypeOf('function')
    if (!countLines) return

    const file = fileAt(vault, path)
    // Exactly the three prose lines — NOT four. The managed link line must be
    // excluded (counting it is the negative-control bug), as must the frontmatter.
    expect(
      await countLines.call(store, file),
      'only the 3 real prose lines count; frontmatter + the managed link line are excluded'
    ).toBe(3)
  })

  it('R40: the managed backlink targets the IMMEDIATE parent — project, parent task, or (for a milestone) the project', async () => {
    // negative-control: the backlink ALWAYS points at the project regardless of the
    // immediate parent, so a subtask under a parent task links the wrong note and
    // the graph mis-nests it directly under the project.
    const { store, vault } = newStore()
    const project = await store.createProject('Tree', 'Projects')

    // (a) a task directly under the project → links the project note.
    const topTask = makeTask({ title: 'Top level task' })
    await store.insertTask(project, topTask)
    // (b) a subtask under that task → links the PARENT TASK (not the project).
    const sub = makeTask({ title: 'Nested subtask' })
    await store.insertTask(project, sub, topTask.id)
    // (c) a milestone under the project → links the project note.
    const milestone = makeTask({ title: 'A milestone', type: 'milestone' })
    await store.insertTask(project, milestone)

    const projectBasename = basenameOf(project.filePath)
    const topBasename = basenameOf(topTask.filePath)

    const targetsOf = async (filePath: string | undefined): Promise<string[]> => {
      const line = managedLinkLine(await bodyOf(vault, filePath ?? ''))
      expect(line, `every managed item must carry a ${LINK_SENTINEL} backlink line`).toBeTruthy()
      return line ? wikilinkTargets(line) : []
    }

    expect(await targetsOf(topTask.filePath), 'a task under the project links the project note').toContain(
      projectBasename
    )
    const subTargets = await targetsOf(sub.filePath)
    expect(subTargets, 'a subtask under a parent task links the PARENT TASK').toContain(topBasename)
    expect(subTargets, 'the subtask must NOT link the project (that is the negative-control bug)').not.toContain(
      projectBasename
    )
    expect(await targetsOf(milestone.filePath), 'a milestone under the project links the project note').toContain(
      projectBasename
    )
  })
})

// @vitest-environment node
//
// INTENTION TEST — Feature 9 (INT-019), the RED win condition for the
// agent-first `pm` CLI. R41–R46.
//
// This file is the executable contract for a build->test->debug loop, authored
// BEFORE the CLI exists. It MUST run to completion and fail on ASSERTIONS (or
// clean feature-detection), never on compile errors or import-of-nonexistent-
// symbol crashes. The two not-yet-existent CLI entry points (`createPmContext`,
// `runPm`) are loaded through a guarded runtime dynamic import so a missing
// module fails an assertion rather than crashing collection.
//
// The HONEST SUT is a real filesystem. Unlike Features 1–8 (which drive the
// store over the in-memory `test/fakeVault.ts`), the CLI's thesis is "the
// UNMODIFIED plugin `src/store` runs on Node over a real-fs `NodeVaultAdapter`."
// So every test here builds a REAL temp-dir vault (Node `fs` under `os.tmpdir()`)
// and asserts against bytes on disk — the only faithful way to prove the
// reuse thesis and that the CLI writes files a plugin would recognize.
//
// Requirements:
//   R41 — NodeVaultAdapter drives ProjectStore against a real temp-fs vault
//         (round-trips a project + task). The reuse thesis.
//   R42 — `new task --project X --parent Y` creates the file in the INT-020
//         nested layout with a minted id, wired parentId + INT-021 backlink;
//         returns the id in the JSON envelope.
//   R43 — `tree <milestoneId> --sub` emits the nested subtree with the glyph
//         legend + `✎N` content symbol reflecting INT-021 detection.
//   R44 — `today` returns lineage-shaped due-today items with a single overdue
//         pointer only when overdue exists; `--json` envelope stable.
//   R45 — `set <id> due=…` cascades to a dependent; `--dry-run` reports without
//         writing.
//   R46 — `apply <spec>` idempotently creates a nested tree and is a no-op on
//         re-run (upsert by key).

import { mkdtempSync, readFileSync, rmSync, existsSync, appendFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, afterEach, describe, expect, it } from 'vitest'
import { parseFrontmatter } from '../src/store'
import { today } from '../src/dates'

// ─── Pinned CLI surface (probed, not statically imported) ───────────────────

/** The stable JSON envelope every command emits. */
interface PmEnvelope {
  ok: boolean
  command: string
  data?: Record<string, unknown>
  error?: { code: string; message: string; ids?: string[] }
  changed_ids?: string[]
  warnings?: Array<{ code: string; message: string; ids?: string[] }>
  meta?: { vault?: string; dry_run?: boolean; duration_ms?: number }
}

/** What `runPm(argv, opts)` resolves to — the parsed envelope + exit code. */
interface PmResult {
  exitCode: number
  stdout: string
  envelope: PmEnvelope
}

type RunPm = (argv: string[], opts?: { vault?: string; cwd?: string; now?: string }) => Promise<PmResult>

/** The one store instance per invocation the CLI builds over the fs adapter. */
interface PmContextLike {
  vaultRoot: string
  store: {
    createProject: (title: string, folder: string) => Promise<{ filePath: string; id: string }>
    discoverProjects: () => Promise<Array<{ title: string; filePath: string; tasks: unknown[] }>>
    insertTask: (project: unknown, task: unknown, parentId?: string | null) => Promise<void>
  }
}

type CreatePmContext = (opts: { vault: string }) => Promise<PmContextLike>

let runPm: RunPm | undefined
let createPmContext: CreatePmContext | undefined

// Runtime dynamic import with VARIABLE specifiers so tsc/vite treat the
// not-yet-built modules as `Promise<any>` and a missing module resolves to
// `undefined` (a failed assertion below) rather than crashing collection.
beforeAll(async () => {
  const runModule = './src/run'
  const ctxModule = './src/PmContext'
  try {
    const mod = (await import(/* @vite-ignore */ runModule)) as { runPm?: RunPm }
    runPm = mod.runPm
  } catch {
    runPm = undefined
  }
  try {
    const mod = (await import(/* @vite-ignore */ ctxModule)) as { createPmContext?: CreatePmContext }
    createPmContext = mod.createPmContext
  } catch {
    createPmContext = undefined
  }
})

// ─── Real temp-fs vault harness ─────────────────────────────────────────────

const vaults: string[] = []

/** A real, empty temp-dir vault (with a `.obsidian/` marker, as discovery expects). */
function makeVault(): string {
  const root = mkdtempSync(join(tmpdir(), 'pm-cli-'))
  vaults.push(root)
  // Minimal Obsidian marker so `--vault` / auto-discovery treats this as a vault.
  writeFileSync(join(root, '.obsidian-marker'), '')
  return root
}

afterEach(() => {
  while (vaults.length) {
    const root = vaults.pop()
    if (root && existsSync(root)) rmSync(root, { recursive: true, force: true })
  }
})

/** Read + parse a task/project file's frontmatter from real disk. */
function fmOnDisk(vaultRoot: string, relPath: string): Record<string, unknown> {
  const content = readFileSync(join(vaultRoot, relPath), 'utf8')
  return parseFrontmatter(content).frontmatter ?? {}
}

/** The note body (frontmatter stripped) from real disk. */
function bodyOnDisk(vaultRoot: string, relPath: string): string {
  const content = readFileSync(join(vaultRoot, relPath), 'utf8')
  return parseFrontmatter(content).body
}

/** The `[[target]]` / `[[target|alias]]` targets on a single line (alias stripped). */
function wikilinkTargets(line: string): string[] {
  const out: string[] = []
  const re = /\[\[([^\]]+)\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) out.push((m[1].split('|')[0] ?? '').trim())
  return out
}

const LINK_SENTINEL = '<!-- pm:link -->'
const ID_RULE = /^[A-Za-z0-9._-]{1,64}$/

/** Injected clock so every date-bearing rendered surface is byte-deterministic. */
// Track the real clock so the pinned command-`now` and the `today()`-built
// fixtures can never diverge at a midnight date-rollover (determinism).
const NOW = today().toString()

/** Convenience: run a command against a vault and return the result. */
async function run(vault: string, argv: string[]): Promise<PmResult> {
  if (!runPm) throw new Error('runPm unavailable')
  return runPm(argv, { vault, now: NOW })
}

/** The stdout line carrying the bracketed anchor `[id]`, or undefined. */
function stdoutLineWithId(stdout: string, id: string): string | undefined {
  return stdout.split('\n').find((l) => l.includes(`[${id}]`))
}

// ─── Feature 9 — pm CLI (INT-019) ───────────────────────────────────────────

describe('Feature 9 — pm CLI', () => {
  it('R41: NodeVaultAdapter drives ProjectStore against a real temp-fs vault (round-trips a project + task)', async () => {
    // negative-control: the store cannot run over a real filesystem at all —
    // there is no NodeVaultAdapter / PmContext, so nothing lands on disk and a
    // fresh context reads nothing back.
    const vault = makeVault()

    expect(createPmContext, 'cli/src/PmContext.createPmContext must exist').toBeTypeOf('function')
    if (!createPmContext) return

    const ctx = await createPmContext({ vault })
    expect(ctx.vaultRoot, 'the context must expose the resolved vault root').toBe(vault)
    // The context wires the UNMODIFIED plugin store — the reuse thesis.
    expect(ctx.store, 'the context must expose a ProjectStore').toBeTruthy()
    expect(ctx.store.createProject, 'the store must be the real ProjectStore surface').toBeTypeOf('function')
    expect(ctx.store.discoverProjects).toBeTypeOf('function')
    expect(ctx.store.insertTask).toBeTypeOf('function')

    // Create a project + task THROUGH the store, over the real-fs adapter.
    const project = await ctx.store.createProject('Reuse Thesis', 'Work')

    // Forensic: real bytes on real disk (not an in-memory fake).
    const notePath = join(vault, project.filePath)
    expect(existsSync(notePath), 'the project note must be written to real disk by the adapter').toBe(true)
    const projFm = fmOnDisk(vault, project.filePath)
    expect(projFm['pm-project'], 'the on-disk note must carry pm-project frontmatter').toBe(true)

    const projects = await ctx.store.discoverProjects()
    const found = projects.find((p) => p.title === 'Reuse Thesis')
    expect(found, 'discovery over real fs must find the project the store just wrote').toBeDefined()
    if (!found) return

    // A SECOND, independent context over the SAME dir reads it back — a true
    // real-fs round trip (adapter persists, adapter re-reads).
    const ctx2 = await createPmContext({ vault })
    const roundTripped = (await ctx2.store.discoverProjects()).find((p) => p.title === 'Reuse Thesis')
    expect(roundTripped, 'a fresh context must round-trip the project back off disk').toBeDefined()
  })

  it('R42: `new task --project X --parent Y` creates the nested-layout file with a minted id, wired parentId + backlink, and returns the id', async () => {
    // negative-control: the CLI cannot create anything (no `new` verb / no store
    // wiring), so no file appears, no id is minted, and no envelope id is returned.
    const vault = makeVault()
    expect(runPm, 'cli/src/run.runPm must exist').toBeTypeOf('function')
    if (!runPm) return

    const proj = await run(vault, ['new', 'project', '--title', 'Backend', '--dir', 'Work'])
    expect(proj.exitCode, 'a successful command exits 0').toBe(0)
    expect(proj.ok ? true : proj.envelope.ok, 'new project succeeds').toBe(true)
    const projectId = String((proj.envelope.data ?? {}).id ?? '')
    expect(projectId, 'new project returns the minted project id in the envelope').toBeTruthy()

    // A parent task under the project.
    const parent = await run(vault, ['new', 'task', '--project', projectId, '--title', 'Ship v2 API'])
    expect(parent.exitCode).toBe(0)
    const parentId = String((parent.envelope.data ?? {}).id ?? '')
    expect(parentId, 'new task returns a minted id').toBeTruthy()
    expect(ID_RULE.test(parentId), 'the minted id must satisfy the pinned id rule').toBe(true)

    // The task-under-parent (a subtask by parentage).
    const child = await run(vault, ['new', 'task', '--project', projectId, '--parent', parentId, '--title', 'Auth middleware'])
    expect(child.exitCode).toBe(0)
    expect(child.envelope.ok).toBe(true)
    const childId = String((child.envelope.data ?? {}).id ?? '')
    expect(childId, 'the id is returned in the JSON envelope for chaining').toBeTruthy()
    expect(ID_RULE.test(childId), 'the returned id satisfies the pinned id rule').toBe(true)
    expect(child.envelope.changed_ids ?? [], 'changed_ids must include the new id').toContain(childId)

    const childPath = String((child.envelope.data ?? {}).filePath ?? '')
    expect(childPath, 'the envelope must return the created filePath').toBeTruthy()

    // Forensic: the file lands in the INT-020 NESTED layout under the per-project
    // folder's `<Name>_tasks/`, not the old flat sibling.
    expect(childPath, 'the task file must live in the INT-020 nested tasks folder').toMatch(
      /^Work\/Backend\/Backend_tasks\//
    )
    expect(existsSync(join(vault, childPath)), 'the task file must exist on real disk').toBe(true)

    // Wired parentId (frontmatter) …
    const childFm = fmOnDisk(vault, childPath)
    expect(childFm.parentId, 'the task frontmatter parentId must be wired to the parent').toBe(parentId)

    // … plus the INT-021 sentinel-marked backlink to the immediate parent.
    const body = bodyOnDisk(vault, childPath)
    const linkLine = body.split('\n').find((l) => l.includes(LINK_SENTINEL))
    expect(linkLine, `the task body must carry the ${LINK_SENTINEL} managed backlink`).toBeTruthy()
    if (!linkLine) return
    const parentBasename = String((parent.envelope.data ?? {}).filePath ?? '')
      .replace(/^.*\//, '')
      .replace(/\.md$/, '')
    expect(wikilinkTargets(linkLine), 'the backlink must target the immediate parent task').toContain(parentBasename)
  })

  it('R43: `tree <milestoneId> --sub` emits the nested subtree with a glyph legend + content symbol reflecting INT-021 detection', async () => {
    // negative-control: `tree` refuses a non-project handle, or emits no legend and
    // no content signal — so an agent can neither scan by status nor tell an empty
    // note from a full one.
    const vault = makeVault()
    expect(runPm).toBeTypeOf('function')
    if (!runPm) return

    const proj = await run(vault, ['new', 'project', '--title', 'Roadmap', '--dir', 'Work'])
    const projectId = String((proj.envelope.data ?? {}).id ?? '')

    const ms = await run(vault, ['new', 'milestone', '--project', projectId, '--title', 'Launch'])
    expect(ms.exitCode).toBe(0)
    const milestoneId = String((ms.envelope.data ?? {}).id ?? '')
    expect(milestoneId, 'new milestone returns an id').toBeTruthy()

    // A bare child (body will be only the managed backlink) …
    const bare = await run(vault, ['new', 'task', '--project', projectId, '--parent', milestoneId, '--title', 'Bare item'])
    const bareId = String((bare.envelope.data ?? {}).id ?? '')

    // … and a child we give real prose to (appended straight to real disk).
    const proseRes = await run(vault, ['new', 'task', '--project', projectId, '--parent', milestoneId, '--title', 'Prose item'])
    const proseId = String((proseRes.envelope.data ?? {}).id ?? '')
    const prosePath = String((proseRes.envelope.data ?? {}).filePath ?? '')
    expect(prosePath).toBeTruthy()
    appendFileSync(join(vault, prosePath), '\n\nThis note holds real content an agent should read.\n')

    // `tree` on the MILESTONE handle (tree works on ANY item), with the subtree.
    // ASSERT ON THE RENDERED SURFACE (`result.stdout`) — the artifact the agent
    // consumes — not on the JSON envelope.
    const tree = await run(vault, ['tree', milestoneId, '--sub'])
    expect(tree.exitCode, 'tree on a valid milestone exits 0').toBe(0)

    // The glyph legend line opens the printout, byte-exact and greppable.
    expect(tree.stdout, 'the printout opens with the frozen glyph legend line').toContain(
      'legend:  ○ = todo   ◐ = doing   ● = done   ⊘ = blocked   ✎N = N lines of note body   ▸N = N children'
    )
    // The subtree renders as glyph rows: the milestone root + both children.
    expect(stdoutLineWithId(tree.stdout, milestoneId), 'the milestone root row is emitted').toMatch(/[○◐●⊘]\s+\[/)
    const bareLine = stdoutLineWithId(tree.stdout, bareId)
    const proseLine = stdoutLineWithId(tree.stdout, proseId)
    expect(bareLine, 'the bare child appears in the subtree').toBeDefined()
    expect(proseLine, 'the prose child appears in the subtree').toBeDefined()

    // The `✎N` content symbol reflects INT-021 detection ON THE PRINTOUT: a note
    // whose body is only the managed backlink shows NO ✎; one with prose shows ✎N.
    expect(bareLine, 'a managed-backlink-only note shows no ✎ on its row').not.toContain('✎')
    expect(proseLine, 'a note with real prose shows ✎N on its row').toMatch(/✎\d+/)

    // Exit-code contract: an unknown handle is E_NOT_FOUND (exit 7), never a crash.
    const missing = await run(vault, ['tree', 'no-such-id'])
    expect(missing.exitCode, 'an unknown handle exits 7 (E_NOT_FOUND)').toBe(7)
    expect(missing.envelope.ok).toBe(false)
    expect(missing.envelope.error?.code).toBe('E_NOT_FOUND')
  })

  it('R44: `today` returns lineage-shaped due-today items with a single overdue pointer only when overdue exists', async () => {
    // negative-control: `today` returns a flat list with no lineage, or always
    // emits an overdue pointer even when nothing is overdue (noise).
    const todayIso = today().toString()
    const overdueIso = today().subtract({ days: 3 }).toString()

    // Scenario A: a due-today item (nested, for lineage) AND an overdue item.
    const vaultA = makeVault()
    expect(runPm).toBeTypeOf('function')
    if (!runPm) return
    const pA = await run(vaultA, ['new', 'project', '--title', 'Sprint', '--dir', 'Work'])
    const projA = String((pA.envelope.data ?? {}).id ?? '')
    const epic = await run(vaultA, ['new', 'task', '--project', projA, '--title', 'Epic'])
    const epicId = String((epic.envelope.data ?? {}).id ?? '')
    const dueToday = await run(vaultA, ['new', 'task', '--project', projA, '--parent', epicId, '--title', 'Due today item', '--due', todayIso])
    const dueTodayId = String((dueToday.envelope.data ?? {}).id ?? '')
    await run(vaultA, ['new', 'task', '--project', projA, '--title', 'Overdue item', '--due', overdueIso])

    // ASSERT ON THE RENDERED SURFACE (`result.stdout`). Overdue work EXISTS, so
    // exactly ONE ⚠ pointer must appear — never doubled, and never re-mentioned
    // in the footer (the frozen single-⚠ rule from the Appendix mockup).
    const resA = await run(vaultA, ['today'])
    expect(resA.exitCode).toBe(0)

    expect((resA.stdout.match(/⚠/g) ?? []).length, 'exactly one ⚠ overdue pointer when overdue work exists').toBe(1)
    expect(resA.stdout, 'the overdue pointer is the single neutral top line').toContain('⚠ 1 overdue — pm overdue')
    // Lineage-shaped: the ancestor project + epic headers frame the due-today item.
    expect(resA.stdout).toContain('Sprint')
    expect(resA.stdout).toContain('Epic')
    expect(stdoutLineWithId(resA.stdout, dueTodayId), 'the due-today item is listed').toBeDefined()
    // The footer counts due-today work and must NOT re-mention overdue.
    const footerA = resA.stdout.trimEnd().split('\n').at(-1) ?? ''
    expect(footerA).toContain('due today')
    expect(footerA, 'the footer never re-mentions overdue (single-⚠ rule)').not.toMatch(/overdue/)

    // Scenario B: only a due-today item, nothing overdue → ZERO ⚠ pointers.
    const vaultB = makeVault()
    const pB = await run(vaultB, ['new', 'project', '--title', 'Calm', '--dir', 'Work'])
    const projB = String((pB.envelope.data ?? {}).id ?? '')
    await run(vaultB, ['new', 'task', '--project', projB, '--title', 'Only today', '--due', todayIso])

    const resB = await run(vaultB, ['today'])
    expect(resB.exitCode).toBe(0)
    expect((resB.stdout.match(/⚠/g) ?? []).length, 'no ⚠ pointer when nothing is overdue').toBe(0)
    expect(resB.stdout, 'the printout never mentions overdue when there is none').not.toContain('overdue')
  })

  it('R45: `set <id> due=…` cascades to a dependent; `--dry-run` reports without writing', async () => {
    // negative-control: setting a predecessor's due date does NOT reschedule its
    // dependent (no scheduler pass), and/or `--dry-run` writes to disk anyway.
    const startIso = today().toString()
    const laterIso = today().add({ days: 30 }).toString()

    const vault = makeVault()
    expect(runPm).toBeTypeOf('function')
    if (!runPm) return
    const p = await run(vault, ['new', 'project', '--title', 'Deps', '--dir', 'Work'])
    const projectId = String((p.envelope.data ?? {}).id ?? '')

    // A (predecessor) due today; B depends on A and is due today too, so pushing A
    // out MUST reschedule B forward.
    const aRes = await run(vault, ['new', 'task', '--project', projectId, '--title', 'Predecessor A', '--due', startIso])
    const aId = String((aRes.envelope.data ?? {}).id ?? '')
    const bRes = await run(vault, ['new', 'task', '--project', projectId, '--title', 'Dependent B', '--due', startIso])
    const bId = String((bRes.envelope.data ?? {}).id ?? '')
    const bPath = String((bRes.envelope.data ?? {}).filePath ?? '')
    expect(bPath).toBeTruthy()

    // Wire the dependency B -> depends on A (via the general `set` patch verb).
    const dep = await run(vault, ['set', bId, `dependencies=${aId}`])
    expect(dep.exitCode, 'wiring a dependency via set succeeds').toBe(0)
    const bDueBefore = String(fmOnDisk(vault, bPath).due ?? '')

    // --dry-run: report the would-be change, write NOTHING.
    const dry = await run(vault, ['set', aId, `due=${laterIso}`, '--dry-run'])
    expect(dry.exitCode).toBe(0)
    expect(dry.envelope.meta?.dry_run, 'a --dry-run must be flagged in meta').toBe(true)
    const aDueAfterDry = String(fmOnDisk(vault, String((aRes.envelope.data ?? {}).filePath ?? '')).due ?? '')
    expect(aDueAfterDry, 'a --dry-run must not write the new due date to disk').toBe(startIso)

    // Real run: writes A, and the scheduler cascades to the dependent B.
    const real = await run(vault, ['set', aId, `due=${laterIso}`])
    expect(real.exitCode).toBe(0)
    expect(real.envelope.ok).toBe(true)
    expect(real.envelope.changed_ids ?? [], 'the set target A must be in changed_ids').toContain(aId)

    // Cascade: the dependent B appears among the scheduled/changed ids.
    const scheduled = (real.envelope.data ?? {}).scheduled
    const scheduledIds = Array.isArray(scheduled) ? (scheduled as unknown[]).map(String) : []
    const affected = [...(real.envelope.changed_ids ?? []), ...scheduledIds]
    expect(affected, 'the dependent B must be rescheduled (cascaded) by the set').toContain(bId)

    // Forensic: B's due date actually moved on disk (the cascade was persisted).
    const bDueAfter = String(fmOnDisk(vault, bPath).due ?? '')
    expect(bDueAfter, 'the cascade must be persisted — B moved off its original due date').not.toBe(bDueBefore)
  })

  it('R46: `apply <spec>` idempotently creates a nested tree and is a no-op on re-run (upsert by key)', async () => {
    // negative-control: `apply` is not idempotent — re-running duplicates tasks
    // (no key-based upsert), so the second run reports fresh creates.
    const vault = makeVault()
    expect(runPm).toBeTypeOf('function')
    if (!runPm) return

    const specPath = join(vault, 'roadmap.pm.yaml')
    writeFileSync(
      specPath,
      [
        'project:',
        '  key: roadmap-2026',
        '  title: Roadmap 2026',
        '  dir: Work',
        'tasks:',
        '  - key: ship-v2',
        '    title: Ship v2 API',
        '    status: in-progress',
        '    subtasks:',
        '      - key: openapi',
        '        title: Draft OpenAPI spec',
        '      - key: authmw',
        '        title: Auth middleware',
        ''
      ].join('\n')
    )

    // First apply — creates the nested tree.
    const first = await run(vault, ['apply', specPath])
    expect(first.exitCode, 'apply exits 0 on success').toBe(0)
    expect(first.envelope.ok).toBe(true)
    expect((first.envelope.changed_ids ?? []).length, 'the first apply creates entities').toBeGreaterThan(0)

    // Forensic: the nested project + tasks landed on real disk in the INT-020 layout.
    expect(existsSync(join(vault, 'Work/Roadmap 2026/Roadmap 2026.md')), 'the project note must be created').toBe(true)
    const tasksDir = join(vault, 'Work/Roadmap 2026/Roadmap 2026_tasks')
    expect(existsSync(tasksDir), 'the nested tasks folder must be created').toBe(true)

    // Count task files after the first apply.
    const firstProjects = await run(vault, ['tree', 'roadmap-2026/roadmap-2026'])
    // (handle resolution is best-effort here; the load-bearing assertion is the
    // idempotency of the SECOND apply below.)
    void firstProjects

    // Second apply of the IDENTICAL spec — a no-op (upsert by key, nothing changes).
    const second = await run(vault, ['apply', specPath])
    expect(second.exitCode, 're-applying an unchanged spec exits 0').toBe(0)
    expect(second.envelope.ok).toBe(true)
    expect(
      (second.envelope.changed_ids ?? []).length,
      'a re-apply of the identical spec is a no-op — nothing changes (upsert by key)'
    ).toBe(0)
  })
})

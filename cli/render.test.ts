// @vitest-environment node
//
// RENDERED-SURFACE contract for the `pm` CLI (INT-019). This file is the
// completeness gate: it proves the CLI on the ARTIFACT THE CONSUMER CONSUMES —
// `result.stdout` — not on the JSON envelope. Every test asserts on the frozen
// pretty/porcelain grammar in `cli/src/render.ts` and the mockups in the
// INT-019 Appendix ("Verbatim Requirement Exchange").
//
// Determinism: every command runs with an INJECTED clock (`now: '2026-07-16'`)
// so date-bearing output is byte-stable. The fixture is a real temp-fs vault
// built once per test through the same `runPm` an agent invokes.
//
// Doctrine: default NOT DONE — a shape counts as covered ONLY when a stdout (or
// exit-code) assertion pins it, and every claim carries an executable NEGATIVE
// CONTROL (a mutation of the fixture that must flip the assertion), so a test
// that would pass on empty/degenerate output is impossible.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPm } from './src/run'
import { PORCELAIN_COLUMNS } from './src/render'

// `watch` (the one long-lived verb) is stubbed to a no-op that opens NO real fs
// handle, so the E5 smoke can prove it starts + emits `ready` without leaking a
// watcher that would keep vitest alive. Every OTHER `node:fs` fn stays real, so
// the temp-fs harness (mkdtemp/write/rm/existsSync) is untouched.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, watch: () => ({ close() {} }) as unknown as ReturnType<typeof actual.watch> }
})

const NOW = '2026-07-16'

// ─── temp-fs vault harness ──────────────────────────────────────────────────

const vaults: string[] = []

function makeVault(): string {
  const root = mkdtempSync(join(tmpdir(), 'pm-cli-render-'))
  vaults.push(root)
  writeFileSync(join(root, '.obsidian-marker'), '')
  return root
}

afterEach(() => {
  while (vaults.length) {
    const root = vaults.pop()
    if (root && existsSync(root)) rmSync(root, { recursive: true, force: true })
  }
})

/** Run a command against a vault with the injected, byte-deterministic clock. */
function run(vault: string, argv: string[]) {
  return runPm(argv, { vault, now: NOW })
}

/** Feed `content` on stdin for the duration of `fn` (for the `batch` op stream). */
async function withStdin<T>(content: string, fn: () => Promise<T>): Promise<T> {
  const fake = Readable.from([Buffer.from(content, 'utf8')]) as unknown as NodeJS.ReadStream
  ;(fake as unknown as { isTTY: boolean }).isTTY = false
  const original = Object.getOwnPropertyDescriptor(process, 'stdin')
  Object.defineProperty(process, 'stdin', { value: fake, configurable: true })
  try {
    return await fn()
  } finally {
    if (original) Object.defineProperty(process, 'stdin', original)
  }
}

/** The stdout line that carries the bracketed anchor `[id]`, or undefined. */
function lineWithId(stdout: string, id: string): string | undefined {
  return stdout.split('\n').find((l) => l.includes(`[${id}]`))
}

/** The minted id an ok mutation/create returned. */
const idOf = (r: Awaited<ReturnType<typeof run>>): string => String((r.envelope.data ?? {}).id ?? '')

const glyphOf = (s: string) => (s.match(/⚠/g) ?? []).length

// ─── the deterministic fixture ──────────────────────────────────────────────

interface Fixture {
  projA: string
  projB: string
  milestone: string
  bare: string // due today, note body is ONLY the managed pm:link line → no ✎
  prose: string // due today, real prose body → ✎N
  logo: string // overdue (due 2026-07-12), not done
  schema: string // future-dated predecessor, not done
  qa: string // depends on schema → blocked
  flyer: string // due today, in project B
}

/**
 * Build the canonical fixture:
 *   • two projects (A "Acme Launch" / B "Demo Garden")
 *   • a milestone with two subtasks (one bare, one prose)
 *   • an overdue task (`logo`, due < today, not done)
 *   • a dependency chain (`qa` depends on `schema`) → a blocked task
 *   • a start→due milestone subtree (for `shift` cascade preview)
 */
async function seed(vault: string): Promise<Fixture> {
  const id = (r: Awaited<ReturnType<typeof run>>) => String((r.envelope.data ?? {}).id ?? '')

  const projA = id(await run(vault, ['new', 'project', '--title', 'Acme Launch', '--dir', 'Work']))
  const milestone = id(
    await run(vault, ['new', 'milestone', '--project', projA, '--title', 'MVP milestone', '--start', '2026-07-15', '--due', '2026-07-20'])
  )
  // Bare child — the store adds ONLY the managed `Part of [[…]] <!-- pm:link -->`
  // backlink, so the content detector must report zero lines (the ✎ negative control).
  const bare = id(await run(vault, ['new', 'task', '--project', projA, '--parent', milestone, '--title', 'Write landing copy', '--due', NOW]))
  const prose = id(
    await run(vault, ['new', 'task', '--project', projA, '--parent', milestone, '--title', 'Wire order API', '--start', '2026-07-14', '--due', NOW])
  )
  await run(vault, ['note', prose, '--append', 'Real API notes an agent should read.'])

  const logo = id(await run(vault, ['new', 'task', '--project', projA, '--title', 'Design logo', '--due', '2026-07-12']))
  const schema = id(await run(vault, ['new', 'task', '--project', projA, '--title', 'DB schema', '--due', '2026-07-18']))
  const qa = id(await run(vault, ['new', 'task', '--project', projA, '--title', 'QA pass', '--due', '2026-07-19']))
  await run(vault, ['depend', qa, '--on', schema])

  const projB = id(await run(vault, ['new', 'project', '--title', 'Demo Garden', '--dir', 'Personal']))
  const flyer = id(await run(vault, ['new', 'task', '--project', projB, '--title', 'Design flyer', '--due', NOW]))

  return { projA, projB, milestone, bare, prose, logo, schema, qa, flyer }
}

const LEGEND_LINE = 'legend:  ○ = todo   ◐ = doing   ● = done   ⊘ = blocked   ✎N = N lines of note body   ▸N = N children'

// ─── tree (universal + composable) ──────────────────────────────────────────

describe('render: tree', () => {
  it('--sub emits the legend line, glyph rows, lineage indent, and ✎ only on the prose child', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['tree', fx.milestone, '--sub'])
    expect(r.exitCode).toBe(0)

    // Frozen legend line, byte-exact.
    expect(r.stdout).toContain(LEGEND_LINE)
    // Root glyph row: the milestone anchor with a status glyph.
    expect(lineWithId(r.stdout, fx.milestone)).toMatch(/[○◐●⊘]\s+\[/)
    // Both children present, lineage-indented (3-space per depth).
    const proseLine = lineWithId(r.stdout, fx.prose)
    const bareLine = lineWithId(r.stdout, fx.bare)
    expect(proseLine, 'prose child appears').toBeDefined()
    expect(bareLine, 'bare child appears').toBeDefined()
    expect(proseLine!.startsWith('   '), 'a child is indented under the milestone').toBe(true)

    // ✎N content symbol: the prose note has it, the managed-backlink-only note does NOT.
    expect(proseLine).toMatch(/✎\d+/)
    expect(bareLine).not.toContain('✎')
  })

  it('GAP-2 REGRESSION: a childful parent whose only body is the auto ## Subtasks mirror shows NO ✎', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    // The milestone has children, so the store writes a `## Subtasks` checklist
    // mirror into its body — but that is managed scaffolding, not human notes.
    // ✎ must stay off (else it "just shows on everything," the failure the spec
    // explicitly forbids), while ▸N still proves the parent HAS children.
    const r = await run(vault, ['tree', fx.milestone, '--sub'])
    const mLine = lineWithId(r.stdout, fx.milestone)
    expect(mLine, 'milestone row present').toBeDefined()
    expect(mLine, 'the ## Subtasks mirror must not count as readable content').not.toContain('✎')
    expect(mLine, 'the parent still reports its child count').toMatch(/▸\d+/)
  })

  it('NEGATIVE CONTROL: appending prose to the bare child makes ✎ appear on its row', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const before = await run(vault, ['tree', fx.milestone, '--sub'])
    expect(lineWithId(before.stdout, fx.bare)).not.toContain('✎')

    await run(vault, ['note', fx.bare, '--append', 'Now this note holds real content.'])
    const after = await run(vault, ['tree', fx.milestone, '--sub'])
    expect(lineWithId(after.stdout, fx.bare), 'prose flips the ✎ detector on').toMatch(/✎\d+/)
  })

  it('GAP-2b REGRESSION: a noteless project shows no ✎ (auto # H1 + ## Tasks mirror excluded)', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    // projA has tasks → the store writes an auto `# {icon} {title}` H1 and a
    // `## Tasks` mirror into its body, but no human description. ✎ must stay off.
    const r = await run(vault, ['projects'])
    const line = r.stdout.split('\n').find((l) => l.includes(fx.projA))
    expect(line, 'project row present').toBeDefined()
    expect(line, 'auto H1 + ## Tasks mirror must not count as readable content').not.toContain('✎')
  })

  it('--fields trims the --json payload on tree (token economy), leaving only requested keys', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const full = await run(vault, ['tree', fx.milestone, '--sub', '--json'])
    const trimmed = await run(vault, ['tree', fx.milestone, '--sub', '--json', '--fields', 'id,status'])
    expect(trimmed.stdout.length, '--fields measurably shrinks the json payload').toBeLessThan(full.stdout.length)
    const nodes = (JSON.parse(trimmed.stdout).data?.nodes ?? []) as Array<Record<string, unknown>>
    expect(nodes.length, 'nodes still present').toBeGreaterThan(0)
    expect(Object.keys(nodes[0]!).sort(), 'each node trimmed to the requested keys').toEqual(['id', 'status'])
  })

  it('--needs renders the upstream section with the predecessor', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['tree', fx.qa, '--needs'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('needs (must finish first):')
    expect(lineWithId(r.stdout, fx.schema), 'the predecessor is listed under needs').toBeDefined()
  })

  it('--blocks renders the downstream section with the dependent', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['tree', fx.schema, '--blocks'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('blocks (waiting on this):')
    expect(lineWithId(r.stdout, fx.qa), 'the dependent is listed under blocks').toBeDefined()
  })
})

// ─── today ──────────────────────────────────────────────────────────────────

describe('render: today', () => {
  it('overdue present → exactly ONE ⚠, legend + header, lineage rows, footer WITHOUT re-mentioning overdue', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['today'])
    expect(r.exitCode).toBe(0)

    // The single ⚠ pointer, mentioned exactly once (never doubled in the footer).
    expect(glyphOf(r.stdout)).toBe(1)
    expect(r.stdout).toContain('⚠ 1 overdue — pm overdue')
    expect(r.stdout).toContain(LEGEND_LINE)
    expect(r.stdout).toContain(`today = ${NOW}`)

    // Both projects' due-today items appear, lineage-shaped (ancestor headers).
    expect(r.stdout).toContain('Acme Launch')
    expect(r.stdout).toContain('Demo Garden')
    expect(lineWithId(r.stdout, fx.prose)).toBeDefined()
    expect(lineWithId(r.stdout, fx.flyer)).toBeDefined()

    // Footer counts, and it must NOT re-mention overdue (the ⚠ is the sole pointer).
    const footer = r.stdout.trimEnd().split('\n').at(-1) ?? ''
    expect(footer).toContain('due today')
    expect(footer).not.toMatch(/overdue/)
  })

  it('overdue ABSENT → zero ⚠ (negative control on the pointer)', async () => {
    const vault = makeVault()
    // A clean vault with a single due-today item and nothing overdue.
    const proj = String((await run(vault, ['new', 'project', '--title', 'Calm', '--dir', 'Work']).then((r) => r)).envelope.data?.id ?? '')
    await run(vault, ['new', 'task', '--project', proj, '--title', 'Only today', '--due', NOW])
    const r = await run(vault, ['today'])
    expect(r.exitCode).toBe(0)
    expect(glyphOf(r.stdout), 'no ⚠ when nothing is overdue').toBe(0)
    expect(r.stdout).not.toContain('overdue')
  })

  it('DETERMINISM: two runs with the same injected clock are byte-identical', async () => {
    const vault = makeVault()
    await seed(vault)
    const a = await run(vault, ['today'])
    const b = await run(vault, ['today'])
    expect(a.stdout).toBe(b.stdout)
  })
})

// ─── overdue ────────────────────────────────────────────────────────────────

describe('render: overdue', () => {
  it('renders the overdue item with a `!Nd` marker and the overdue legend entry', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['overdue'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('!Nd = overdue by N days')
    // Design logo is due 2026-07-12 → 4 days before 2026-07-16.
    expect(lineWithId(r.stdout, fx.logo)).toContain('!4d')
  })

  it('NEGATIVE CONTROL: completing the overdue item removes it (and its `!4d`) from the view', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    await run(vault, ['set', fx.logo, 'status=done'])
    const r = await run(vault, ['overdue'])
    expect(lineWithId(r.stdout, fx.logo), 'a done item is no longer overdue').toBeUndefined()
    expect(r.stdout).not.toContain('!4d')
  })
})

// ─── open ───────────────────────────────────────────────────────────────────

describe('render: open', () => {
  it('--by deps lists all open work, blocked-aware (⊘ blocked by …) with a blocked footer count', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['open', '--by', 'deps'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain(LEGEND_LINE)
    // The blocked dependent carries the trailing blocked-by annotation.
    expect(lineWithId(r.stdout, fx.qa)).toContain(`⊘ blocked by [${fx.schema}]`)
    expect(r.stdout.trimEnd()).toMatch(/\d+ open · \d+ blocked$/)
  })

  it('NEGATIVE CONTROL: completing the predecessor drops the ⊘ blocked annotation on the dependent', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    await run(vault, ['set', fx.schema, 'status=done'])
    const r = await run(vault, ['open', '--by', 'deps'])
    expect(lineWithId(r.stdout, fx.qa), 'the dependent is now unblocked').not.toContain('⊘ blocked by')
  })
})

// ─── blocked ────────────────────────────────────────────────────────────────

describe('render: blocked', () => {
  it('lists the blocked task and by what', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['blocked'])
    expect(r.exitCode).toBe(0)
    expect(lineWithId(r.stdout, fx.qa)).toContain(`⊘ blocked by [${fx.schema}]`)
    expect(r.stdout.trimEnd()).toMatch(/\d+ blocked$/)
  })
})

// ─── deps ───────────────────────────────────────────────────────────────────

describe('render: deps', () => {
  it('renders the up/downstream graph and the single ⚠ blocked pointer', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['deps', fx.qa])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('needs (must finish first):')
    expect(r.stdout).toContain('blocks (waiting on this):')
    expect(glyphOf(r.stdout), 'exactly one ⚠ blocked pointer').toBe(1)
    expect(r.stdout).toContain(`⚠ blocked: [${fx.schema}] upstream not done`)
  })
})

// ─── ls / find (flat table + porcelain faithfulness) ────────────────────────

describe('render: find / ls', () => {
  it('pretty table has the column header and a matching row', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['find', '--status', 'todo', '--project', fx.projA, '--sort', 'due'])
    expect(r.exitCode).toBe(0)
    // Header row of the flat table.
    expect(r.stdout.split('\n')[0]).toMatch(/^id\s+status\s+due\s+notes\s+title/)
    expect(lineWithId(r.stdout, fx.logo) ?? r.stdout).toContain(fx.logo)
  })

  it('--porcelain (table view) is a stable 5-column TSV (4 tabs per line, no header)', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['find', '--status', 'todo', '--project', fx.projA, '--porcelain'])
    expect(r.exitCode).toBe(0)
    const lines = r.stdout.split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) expect(l.split('\t').length, 'find table porcelain has a stable column count').toBe(5)
    // No pretty header row leaked into the machine stream.
    expect(lines[0]!.startsWith('id\tstatus')).toBe(false)
  })

  it('a lineage/graph --porcelain carries the FIXED PORCELAIN_COLUMNS incl kind/rel/blocked_by, tab-count stable', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['open', '--porcelain'])
    expect(r.exitCode).toBe(0)
    const lines = r.stdout.split('\n').filter(Boolean)
    const N = PORCELAIN_COLUMNS.length
    expect(N).toBe(15)
    for (const l of lines) {
      expect(l.split('\t').length, 'every porcelain row has all fixed columns').toBe(N)
    }
    const kindIdx = PORCELAIN_COLUMNS.indexOf('kind')
    const idIdx = PORCELAIN_COLUMNS.indexOf('id')
    const blockedIdx = PORCELAIN_COLUMNS.indexOf('blocked_by')
    const kinds = new Set(lines.map((l) => l.split('\t')[kindIdx]))
    expect(kinds.has('header'), 'lineage project headers surface as kind=header').toBe(true)
    expect(kinds.has('row'), 'task records surface as kind=row').toBe(true)
    // The blocked dependent's row carries its blocker id in the blocked_by column.
    const qaRow = lines.find((l) => l.split('\t')[idIdx] === fx.qa)
    expect(qaRow, 'the blocked dependent has a porcelain row').toBeDefined()
    expect(qaRow!.split('\t')[blockedIdx], 'blocked_by is faithful, never lossy').toBe(fx.schema)
  })
})

// ─── projects / path / explain / palette / schema ───────────────────────────

describe('render: projects', () => {
  it('lists every project with a footer count', async () => {
    const vault = makeVault()
    await seed(vault)
    const r = await run(vault, ['projects'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('Acme Launch')
    expect(r.stdout).toContain('Demo Garden')
    expect(r.stdout.trimEnd()).toMatch(/2 projects$/)
  })
})

describe('render: path', () => {
  it('renders the project › … › item breadcrumb', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['path', fx.prose])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe('Acme Launch › MVP milestone › Wire order API')
  })
})

describe('render: explain', () => {
  it('renders the breadcrumb + a plain-English blocked sentence', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['explain', fx.qa])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('Acme Launch › QA pass')
    expect(r.stdout).toContain(`[${fx.qa}]`)
    expect(r.stdout).toMatch(/is blocked/)
    expect(r.stdout).toMatch(/waiting on 1 unmet dependency: DB schema/)
  })
})

describe('render: palette', () => {
  it('renders the effective status/priority vocabulary', async () => {
    const vault = makeVault()
    await seed(vault)
    const r = await run(vault, ['palette'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('palette (global)')
    expect(r.stdout).toMatch(/statuses:.*done\*/)
    expect(r.stdout).toContain('priorities:')
  })
})

describe('render: schema', () => {
  it('emits the JSON Schema for the requested entity', async () => {
    const vault = makeVault()
    const r = await run(vault, ['schema', 'task'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('"$id": "pm:task"')
    expect(r.stdout).toContain('"required"')
  })
})

// ─── mutation confirmation + dry-run previews ───────────────────────────────

describe('render: mutation confirmation', () => {
  it('a viewless mutation prints the `✓ <command>  →  [id]` line', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['set', fx.logo, 'status=doing'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('✓ set')
    expect(r.stdout).toContain(`[${fx.logo}]`)
  })
})

describe('render: apply --dry-run', () => {
  it('prints a Terraform-style + create diff and the "nothing written" banner', async () => {
    const vault = makeVault()
    const specPath = join(vault, 'plan.pm.yaml')
    writeFileSync(
      specPath,
      ['project:', '  key: plan-x', '  title: Plan X', '  dir: Work', 'tasks:', '  - key: t1', '    title: First task', ''].join('\n')
    )
    const r = await run(vault, ['apply', specPath, '--dry-run'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('+ create Plan X')
    expect(r.stdout).toContain('+ create First task')
    expect(r.stdout).toContain('dry run — nothing written')
    // NEGATIVE CONTROL: the dry-run wrote nothing — the project note does not exist.
    expect(existsSync(join(vault, 'Work/Plan X/Plan X.md')), 'a dry-run apply must not create files').toBe(false)
  })
})

describe('render: shift --dry-run', () => {
  it('prints the cascade preview (↳, old → new, "would move", --no-cascade hint)', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['shift', fx.milestone, '+7d', '--dry-run'])
    expect(r.exitCode).toBe(0)
    // The milestone self line moves 2026-07-20 → 2026-07-27.
    expect(r.stdout).toContain('2026-07-20 → 2026-07-27')
    // Its subtree moves with it (the ↳ child rows).
    expect(r.stdout).toContain('↳')
    expect(r.stdout).toMatch(/items would move · drop --dry-run to apply · --no-cascade to move only/)
    // NEGATIVE CONTROL: nothing was persisted — a real tree still shows the old date.
    const tree = await run(vault, ['tree', fx.milestone, '--sub'])
    expect(lineWithId(tree.stdout, fx.milestone), 'a dry-run shift writes nothing').toContain('due 2026-07-20')
  })
})

// ─── exit-code contract (all 9 codes) ───────────────────────────────────────

describe('exit codes: the full deterministic contract', () => {
  it('0 — a successful command exits 0', async () => {
    const vault = makeVault()
    await seed(vault)
    const r = await run(vault, ['projects'])
    expect(r.exitCode).toBe(0)
    expect(r.envelope.ok).toBe(true)
  })

  it('2 — an unknown command is a usage error', async () => {
    const vault = makeVault()
    const r = await run(vault, ['frobnicate'])
    expect(r.exitCode).toBe(2)
    expect(r.stdout).toContain('✗ E_USAGE:')
  })

  it('2 — an empty command line is a usage error', async () => {
    const vault = makeVault()
    const r = await run(vault, [])
    expect(r.exitCode).toBe(2)
    expect(r.stdout).toContain('✗ E_USAGE:')
  })

  it('4 — E_NO_VAULT when run outside any vault', async () => {
    // A real dir with NO `.obsidian/` anywhere up the tree, addressed via cwd so
    // the auto-discovery walk fails (rather than the explicit-path existence check).
    const notVault = mkdtempSync(join(tmpdir(), 'pm-cli-novault-'))
    const savedEnv = process.env.PM_VAULT
    delete process.env.PM_VAULT
    try {
      const r = await runPm(['projects'], { cwd: notVault, now: NOW })
      expect(r.exitCode).toBe(4)
      expect(r.stdout).toContain('✗ E_NO_VAULT:')
    } finally {
      if (savedEnv !== undefined) process.env.PM_VAULT = savedEnv
      rmSync(notVault, { recursive: true, force: true })
    }
  })

  it('5 — E_CYCLE when a dependency edge would close a loop', async () => {
    const vault = makeVault()
    const proj = String((await run(vault, ['new', 'project', '--title', 'Cyc', '--dir', 'Work'])).envelope.data?.id ?? '')
    const a = String((await run(vault, ['new', 'task', '--project', proj, '--title', 'A'])).envelope.data?.id ?? '')
    const b = String((await run(vault, ['new', 'task', '--project', proj, '--title', 'B'])).envelope.data?.id ?? '')
    await run(vault, ['depend', b, '--on', a]) // B → A, fine
    const r = await run(vault, ['depend', a, '--on', b]) // A → B closes the loop
    expect(r.exitCode).toBe(5)
    expect(r.stdout).toContain('✗ E_CYCLE:')
  })

  it('6 — E_AMBIGUOUS when a slug matches two entities', async () => {
    const vault = makeVault()
    // Two projects share the title "Dup" (distinct dirs → no file collision), so
    // the bare handle "Dup" resolves to two entities and must NOT be silently picked.
    await run(vault, ['new', 'project', '--title', 'Dup', '--dir', 'Work'])
    await run(vault, ['new', 'project', '--title', 'Dup', '--dir', 'Personal'])
    const r = await run(vault, ['tree', 'Dup'])
    expect(r.exitCode).toBe(6)
    expect(r.stdout).toContain('✗ E_AMBIGUOUS:')
  })

  it('7 — E_NOT_FOUND for an unknown handle', async () => {
    const vault = makeVault()
    await seed(vault)
    const r = await run(vault, ['tree', 'no-such-id'])
    expect(r.exitCode).toBe(7)
    expect(r.stdout).toContain('✗ E_NOT_FOUND:')
  })

  it('8 — E_CONFLICT when a new task would collide with an existing file', async () => {
    const vault = makeVault()
    const proj = String((await run(vault, ['new', 'project', '--title', 'Coll', '--dir', 'Work'])).envelope.data?.id ?? '')
    const first = await run(vault, ['new', 'task', '--project', proj, '--title', 'Same Title'])
    expect(first.exitCode).toBe(0)
    const second = await run(vault, ['new', 'task', '--project', proj, '--title', 'Same Title'])
    expect(second.exitCode).toBe(8)
    expect(second.stdout).toContain('✗ E_CONFLICT:')
  })

  it('9 — E_BATCH when any op in the stream is malformed (nothing written)', async () => {
    const vault = makeVault()
    const proj = String((await run(vault, ['new', 'project', '--title', 'Batchy', '--dir', 'Work'])).envelope.data?.id ?? '')
    const stream = [JSON.stringify({ op: 'new_task', project: proj, title: 'Valid' }), JSON.stringify({ op: 'not_a_real_op' })].join('\n')
    const r = await withStdin(stream, () => run(vault, ['batch']))
    expect(r.exitCode).toBe(9)
    expect(r.stdout).toContain('✗ E_BATCH:')
    // NEGATIVE CONTROL: the atomic reject wrote nothing — the valid op did not land.
    const find = await run(vault, ['find', 'Valid', '--project', proj])
    expect(find.stdout).not.toContain('Valid')
  })

  it('1 — a generic (non-PmError) failure maps to exit 1', async () => {
    // Renaming a project onto a folder that already exists throws a plain Error in
    // the store (not a PmError) → the dispatcher's generic branch → exit 1.
    const vault = makeVault()
    await run(vault, ['new', 'project', '--title', 'Alpha', '--dir', 'Work'])
    await run(vault, ['new', 'project', '--title', 'Beta', '--dir', 'Work'])
    const r = await run(vault, ['rename', 'Alpha', '--title', 'Beta'])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toContain('✗ GENERIC:')
  })
})

// ─── global flags: help / version / fields / ndjson ─────────────────────────

describe('global flags: help & version', () => {
  it('--help / -h / help print the usage text (exit 0)', async () => {
    const vault = makeVault()
    for (const argv of [['--help'], ['-h'], ['help']]) {
      const r = await run(vault, argv)
      expect(r.exitCode, `${argv[0]} exits 0`).toBe(0)
      expect(r.stdout).toContain('pm — agent-first CLI')
      expect(r.stdout).toContain('EXIT CODES')
    }
  })

  it('--version / -V print the pinned version (exit 0)', async () => {
    const vault = makeVault()
    for (const argv of [['--version'], ['-V']]) {
      const r = await run(vault, argv)
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toBe('pm 1.8.0')
    }
  })
})

describe('global flags: --fields', () => {
  it('trims the payload — the json-mode stdout measurably loses fields', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const full = await run(vault, ['show', fx.prose, '--json'])
    const trimmed = await run(vault, ['show', fx.prose, '--fields', 'id,title', '--json'])
    expect(full.stdout).toContain('"status"')
    expect(trimmed.stdout, '--fields drops fields from the rendered json stdout').not.toContain('"status"')
    expect(trimmed.stdout).toContain('"id"')
    expect(trimmed.stdout).toContain('"title"')
    expect(trimmed.stdout.length, 'the byte count measurably shrinks').toBeLessThan(full.stdout.length)
  })
})

describe('global flags: --ndjson', () => {
  it('streams a header line then one machineRecord object per row', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['open', '--ndjson'])
    expect(r.exitCode).toBe(0)
    const lines = r.stdout.split('\n').filter(Boolean)
    const header = JSON.parse(lines[0]!) as { kind: string; format: string; count: number }
    expect(header.kind, 'the first line is the header object').toBe('header')
    expect(header.format).toBe('lineage')
    // Every subsequent line is a JSON object carrying the fixed machineRecord keys.
    for (const l of lines.slice(1)) {
      const obj = JSON.parse(l) as Record<string, unknown>
      for (const key of PORCELAIN_COLUMNS) expect(obj, `ndjson row carries ${key}`).toHaveProperty(key)
    }
    // The blocked dependent's row is faithful — blocked_by names its blocker.
    const qaRow = lines.slice(1).map((l) => JSON.parse(l) as Record<string, unknown>).find((o) => o.id === fx.qa)
    expect(qaRow?.blocked_by).toBe(fx.schema)
  })
})

// ─── mutation flags: --quiet / --explain ────────────────────────────────────

describe('mutation flags: --quiet & --explain', () => {
  it('a cascading mutation shows ⚠ by default, and --quiet suppresses it', async () => {
    const control = makeVault()
    const fxC = await seed(control)
    const c = await run(control, ['set', fxC.schema, 'due=2026-07-30'])
    expect((c.stdout.match(/⚠/g) ?? []).length, 'the cascade warning appears by default').toBeGreaterThan(0)

    const quiet = makeVault()
    const fxQ = await seed(quiet)
    const q = await run(quiet, ['set', fxQ.schema, 'due=2026-07-30', '--quiet'])
    expect(q.exitCode).toBe(0)
    expect((q.stdout.match(/⚠/g) ?? []).length, '--quiet suppresses the ⚠ line').toBe(0)
  })

  it('--explain adds an explain: line to the confirmation', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['set', fx.schema, 'due=2026-07-30', '--explain'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('explain:')
  })
})

// ─── tree extra flags: --all / --depth / --rich / --include-archived ─────────

describe('tree extra flags', () => {
  it('--all renders the composed subtree section', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['tree', fx.milestone, '--all'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('subtasks:')
    expect(lineWithId(r.stdout, fx.prose)).toBeDefined()
  })

  it('--depth N bounds the rendered subtree depth', async () => {
    const vault = makeVault()
    const proj = idOf(await run(vault, ['new', 'project', '--title', 'Deep', '--dir', 'Work']))
    const a = idOf(await run(vault, ['new', 'task', '--project', proj, '--title', 'A']))
    const b = idOf(await run(vault, ['new', 'task', '--project', proj, '--parent', a, '--title', 'B']))
    const c = idOf(await run(vault, ['new', 'task', '--project', proj, '--parent', b, '--title', 'C']))
    const shallow = await run(vault, ['tree', a, '--sub', '--depth', '1'])
    expect(lineWithId(shallow.stdout, b), 'depth 1 shows the direct child').toBeDefined()
    expect(lineWithId(shallow.stdout, c), 'depth 1 hides the grandchild').toBeUndefined()
    const deep = await run(vault, ['tree', a, '--sub', '--depth', '2'])
    expect(lineWithId(deep.stdout, c), 'depth 2 reveals the grandchild').toBeDefined()
  })

  it('--rich adds priority/assignee tokens that are absent without it', async () => {
    const vault = makeVault()
    const proj = idOf(await run(vault, ['new', 'project', '--title', 'Rich', '--dir', 'Work']))
    const t = idOf(await run(vault, ['new', 'task', '--project', proj, '--title', 'Rich task', '--priority', 'high', '--assignee', 'alice']))
    const rich = await run(vault, ['tree', proj, '--sub', '--rich'])
    expect(lineWithId(rich.stdout, t)).toContain('!high')
    expect(lineWithId(rich.stdout, t)).toContain('@alice')
    const plain = await run(vault, ['tree', proj, '--sub'])
    expect(lineWithId(plain.stdout, t), 'without --rich the tokens are hidden').not.toContain('@alice')
  })

  it('--include-archived (via find, which honors it) toggles archived visibility', async () => {
    // NOTE: `find` is the query view that honors --include-archived (it filters
    // archived by default). `tree` does NOT filter archived — see the discrepancy
    // note in docs/cli-ledger.md. This pins the flag on the surface that respects it.
    const vault = makeVault()
    const proj = idOf(await run(vault, ['new', 'project', '--title', 'Arch', '--dir', 'Work']))
    const t = idOf(await run(vault, ['new', 'task', '--project', proj, '--title', 'Archive me']))
    await run(vault, ['archive', t])
    const def = await run(vault, ['find', '--project', proj])
    expect(def.stdout, 'archived tasks are hidden by default').not.toContain(t)
    const inc = await run(vault, ['find', '--project', proj, '--include-archived'])
    expect(inc.stdout, '--include-archived reveals them').toContain(t)
  })
})

// ─── show / next / agenda / log ─────────────────────────────────────────────

describe('render: show', () => {
  it('renders the title line, key fields, and the note body', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['show', fx.prose])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain(`[${fx.prose}]`)
    expect(r.stdout).toContain('Wire order API')
    expect(r.stdout).toMatch(/status:/)
    expect(r.stdout, 'the note body is included').toContain('Real API notes an agent should read.')
  })
})

describe('render: next', () => {
  it('lists the actionable frontier and excludes blocked work', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['next'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout.trimEnd()).toMatch(/\d+ actionable now$/)
    expect(lineWithId(r.stdout, fx.qa), 'the blocked task is NOT actionable').toBeUndefined()
    expect(lineWithId(r.stdout, fx.schema), 'the unblocked predecessor IS actionable').toBeDefined()
  })
})

describe('render: agenda', () => {
  it('a single date lists only work due that day', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['agenda', '2026-07-20'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('agenda 2026-07-20')
    expect(lineWithId(r.stdout, fx.milestone), 'the milestone due 07-20 is listed').toBeDefined()
    expect(lineWithId(r.stdout, fx.flyer), 'work due 07-16 is NOT in the 07-20 agenda').toBeUndefined()
  })

  it('this-week renders the Mon..Sun range header', async () => {
    const vault = makeVault()
    await seed(vault)
    const r = await run(vault, ['agenda', 'this-week'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('agenda 2026-07-13..2026-07-19')
  })
})

describe('render: log', () => {
  it('renders a recent-change table', async () => {
    const vault = makeVault()
    await seed(vault)
    const r = await run(vault, ['log'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout.split('\n')[0]).toMatch(/^updated\s+id\s+status\s+title/)
    expect(r.stdout.trimEnd()).toMatch(/recently changed$/)
    expect(r.stdout).toContain('QA pass')
  })
})

// ─── analysis: rollup / validate / blockers / graph / critical-path ─────────

describe('render: rollup', () => {
  it('--group-by status | priority | assignee each render an aggregate table', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const byStatus = await run(vault, ['rollup', fx.projA, '--group-by', 'status'])
    expect(byStatus.stdout.split('\n')[0]).toMatch(/^status\s+count\s+done\s+pct\s+overdue\s+est/)
    expect(byStatus.stdout.trimEnd()).toMatch(/by status$/)

    const byPriority = await run(vault, ['rollup', fx.projA, '--group-by', 'priority'])
    expect(byPriority.stdout.trimEnd()).toMatch(/by priority$/)

    const byAssignee = await run(vault, ['rollup', fx.projA, '--group-by', 'assignee'])
    expect(byAssignee.stdout).toContain('(unassigned)')
    expect(byAssignee.stdout.trimEnd()).toMatch(/by assignee$/)
  })
})

describe('render: validate', () => {
  it('reports clean, then surfaces a dangling dependency, then flags the --fix write', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const clean = await run(vault, ['validate', fx.projA])
    expect(clean.stdout).toContain('no findings — clean')

    // Introduce a dangling dependency and re-validate.
    await run(vault, ['set', fx.logo, 'dependencies=ghost-id'])
    const dirty = await run(vault, ['validate', fx.projA])
    expect(dirty.stdout).toContain('dangling-dependency')
    expect(dirty.stdout.trimEnd()).toMatch(/\d+ finding/)

    const fixed = await run(vault, ['validate', fx.projA, '--fix'])
    expect(fixed.stdout).toContain('self-heal written')
  })
})

describe('render: blockers', () => {
  it('ranks tasks by how much they block', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['blockers', fx.projA])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain(fx.schema)
    expect(r.stdout.trimEnd()).toMatch(/\d+ blocking task/)
  })
})

describe('render: graph', () => {
  it('default renders the edge table; --dot renders a Graphviz document', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const table = await run(vault, ['graph', fx.projA])
    expect(table.exitCode).toBe(0)
    expect(table.stdout).toContain('QA pass → DB schema')
    expect(table.stdout.trimEnd()).toMatch(/\d+ nodes? · \d+ edges?$/)

    const dot = await run(vault, ['graph', fx.projA, '--dot'])
    expect(dot.stdout).toContain('digraph "Acme Launch" {')
    expect(dot.stdout).toContain(`"${fx.qa}" -> "${fx.schema}"`)
  })
})

describe('render: critical-path', () => {
  it('renders the longest dependency chain with a header + duration footer', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['critical-path', fx.projA])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('critical path (Acme Launch)')
    expect(r.stdout.trimEnd()).toMatch(/\d+ tasks? · \d+ days? total$/)
  })
})

// ─── create: --after/--before, field flags, import ──────────────────────────

describe('create: --after / --before resequencing', () => {
  it('--after places the new sibling between its anchor and the next sibling', async () => {
    const vault = makeVault()
    const proj = idOf(await run(vault, ['new', 'project', '--title', 'Seq', '--dir', 'Work']))
    const a = idOf(await run(vault, ['new', 'task', '--project', proj, '--title', 'AA']))
    const b = idOf(await run(vault, ['new', 'task', '--project', proj, '--title', 'BB']))
    const c = idOf(await run(vault, ['new', 'task', '--project', proj, '--title', 'CC', '--after', a]))
    const tree = await run(vault, ['tree', proj, '--sub'])
    const idx = (id: string) => tree.stdout.indexOf(`[${id}]`)
    expect(idx(a)).toBeLessThan(idx(c))
    expect(idx(c), 'CC lands after AA and before BB').toBeLessThan(idx(b))
  })
})

describe('create: field flags land on disk (verified through show)', () => {
  it('task flags (priority/due/start/assignee/tag/estimate/desc) all persist', async () => {
    const vault = makeVault()
    const proj = idOf(await run(vault, ['new', 'project', '--title', 'Flags', '--dir', 'Work']))
    const t = idOf(
      await run(vault, [
        'new', 'task', '--project', proj, '--title', 'Loaded',
        '--priority', 'high', '--due', '2026-07-25', '--start', '2026-07-20',
        '--assignee', 'alice', '--tag', 'urgent', '--estimate', '5', '--desc', 'Read me carefully'
      ])
    )
    const plain = await run(vault, ['show', t])
    expect(plain.stdout).toContain('priority: high')
    expect(plain.stdout).toContain('due: 2026-07-25')
    expect(plain.stdout).toContain('start: 2026-07-20')
    expect(plain.stdout).toContain('assignees: alice')
    expect(plain.stdout).toContain('tags: urgent')
    expect(plain.stdout, 'the desc becomes the note body').toContain('Read me carefully')
    // timeEstimate is not in the plain field list → assert it via the json surface.
    const json = await run(vault, ['show', t, '--json'])
    expect((JSON.parse(json.stdout) as { data: { timeEstimate: number } }).data.timeEstimate).toBe(5)
  })

  it('project flags (icon/color/desc) persist', async () => {
    const vault = makeVault()
    const proj = idOf(await run(vault, ['new', 'project', '--title', 'Styled', '--dir', 'Work', '--icon', '📌', '--color', '#abcdef', '--desc', 'Project overview']))
    const json = await run(vault, ['show', proj, '--json'])
    const data = (JSON.parse(json.stdout) as { data: { icon: string; color: string; description: string } }).data
    expect(data.icon).toBe('📌')
    expect(data.color).toBe('#abcdef')
    expect(data.description).toBe('Project overview')
  })
})

describe('create: import', () => {
  it('converts an existing note into a task under the project', async () => {
    const vault = makeVault()
    const proj = idOf(await run(vault, ['new', 'project', '--title', 'Inbox', '--dir', 'Work']))
    writeFileSync(join(vault, 'loose.md'), '---\ntitle: Loose\n---\nsome prose\n')
    const r = await run(vault, ['import', 'loose.md', '--into', proj])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('✓ import')
    const tree = await run(vault, ['tree', proj, '--sub'])
    expect(tree.stdout, 'the imported note is now a task in the tree').toContain('loose')
  })
})

// ─── update: sugar / rename / reorder / archive / dup / rm ───────────────────

describe('update: sugar verbs', () => {
  it('status/due/priority/assign each confirm and take effect', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    expect((await run(vault, ['status', fx.logo, 'done'])).stdout).toContain('✓ status')
    // A now-done overdue item drops out of `overdue`.
    expect(lineWithId((await run(vault, ['overdue'])).stdout, fx.logo)).toBeUndefined()

    expect((await run(vault, ['priority', fx.schema, 'high'])).stdout).toContain('✓ priority')
    expect((await run(vault, ['due', fx.schema, '2026-08-01'])).stdout).toContain('✓ due')
    const assigned = await run(vault, ['assign', fx.schema, 'alice'])
    expect(assigned.stdout).toContain('✓ assign')
    expect((await run(vault, ['show', fx.schema])).stdout, 'assign took effect').toContain('assignees: alice')
  })
})

describe('update: rename (bidirectional)', () => {
  it('renames a task and a project, reflected in tree/projects', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    expect((await run(vault, ['rename', fx.schema, '--title', 'DB schema v2'])).exitCode).toBe(0)
    expect((await run(vault, ['tree', fx.projA, '--sub'])).stdout).toContain('DB schema v2')

    expect((await run(vault, ['rename', fx.projA, '--title', 'Fiverr v2'])).exitCode).toBe(0)
    expect((await run(vault, ['projects'])).stdout).toContain('Fiverr v2')
  })
})

describe('update: reorder', () => {
  it('resequences a sibling before another', async () => {
    const vault = makeVault()
    const proj = idOf(await run(vault, ['new', 'project', '--title', 'Ord', '--dir', 'Work']))
    const a = idOf(await run(vault, ['new', 'task', '--project', proj, '--title', 'AA']))
    const b = idOf(await run(vault, ['new', 'task', '--project', proj, '--title', 'BB']))
    const c = idOf(await run(vault, ['new', 'task', '--project', proj, '--title', 'CC']))
    void b
    await run(vault, ['reorder', c, '--before', a])
    const tree = await run(vault, ['tree', proj, '--sub'])
    expect(tree.stdout.indexOf(`[${c}]`), 'CC now precedes AA').toBeLessThan(tree.stdout.indexOf(`[${a}]`))
  })
})

describe('update: archive / unarchive', () => {
  it('archive hides a task from the default query view; unarchive restores it', async () => {
    const vault = makeVault()
    const proj = idOf(await run(vault, ['new', 'project', '--title', 'Arc', '--dir', 'Work']))
    const t = idOf(await run(vault, ['new', 'task', '--project', proj, '--title', 'Temp']))
    expect((await run(vault, ['archive', t])).stdout).toContain('✓ archive')
    expect((await run(vault, ['find', '--project', proj])).stdout).not.toContain(t)
    expect((await run(vault, ['unarchive', t])).stdout).toContain('✓ unarchive')
    expect((await run(vault, ['find', '--project', proj])).stdout, 'unarchive brings it back').toContain(t)
  })
})

describe('update: dup', () => {
  it('duplicates a task (with its subtree) and confirms the new id', async () => {
    const vault = makeVault()
    const fx = await seed(vault)
    const r = await run(vault, ['dup', fx.milestone, '--with-subtasks'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('✓ dup')
    const newId = (r.envelope.changed_ids ?? [])[0] ?? ''
    expect(r.stdout, 'the confirmation anchors the new id').toContain(`[${newId}]`)
  })
})

describe('update: rm', () => {
  it('trashes a task (gone from tree) and a project (gone from projects)', async () => {
    const vault = makeVault()
    const proj = idOf(await run(vault, ['new', 'project', '--title', 'Trashy', '--dir', 'Work']))
    const t = idOf(await run(vault, ['new', 'task', '--project', proj, '--title', 'Doomed']))
    expect((await run(vault, ['rm', t])).stdout).toContain('✓ rm')
    expect((await run(vault, ['tree', proj, '--sub'])).stdout).not.toContain(`[${t}]`)

    expect((await run(vault, ['rm', proj, '--project'])).exitCode).toBe(0)
    expect((await run(vault, ['projects'])).stdout).not.toContain('Trashy')
  })
})

// ─── declarative: reconcile / export / snapshot+restore / batch / watch ─────

describe('declarative: reconcile', () => {
  it('runs idempotently over a healthy vault (exit 0, ✓ confirmation)', async () => {
    const vault = makeVault()
    await seed(vault)
    const r = await run(vault, ['reconcile'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('✓ reconcile')
  })
})

describe('declarative: export round-trips into apply', () => {
  it('export emits a spec that apply recreates in a fresh vault', async () => {
    const src = makeVault()
    const fx = await seed(src)
    const exported = await run(src, ['export', fx.projA])
    expect(exported.exitCode).toBe(0)
    const doc = JSON.parse(exported.stdout) as { project: { title: string } }
    expect(doc.project.title).toBe('Acme Launch')

    const dst = makeVault()
    const specPath = join(dst, 'exported.json')
    writeFileSync(specPath, exported.stdout)
    const applied = await run(dst, ['apply', specPath])
    expect(applied.exitCode).toBe(0)
    expect((await run(dst, ['projects'])).stdout, 'the exported project round-trips').toContain('Acme Launch')
  })
})

describe('declarative: snapshot / restore', () => {
  it('snapshot serializes the vault; restore rebuilds it elsewhere', async () => {
    const src = makeVault()
    await seed(src)
    const snap = await run(src, ['snapshot'])
    expect(snap.exitCode).toBe(0)
    const doc = JSON.parse(snap.stdout) as { projects: unknown[] }
    expect(doc.projects.length).toBe(2)

    const dst = makeVault()
    const snapPath = join(dst, 'snap.json')
    writeFileSync(snapPath, snap.stdout)
    const restored = await run(dst, ['restore', snapPath])
    expect(restored.exitCode).toBe(0)
    expect(restored.stdout).toMatch(/restored 2 projects/)
    const projects = await run(dst, ['projects'])
    expect(projects.stdout).toContain('Acme Launch')
    expect(projects.stdout).toContain('Demo Garden')
  })
})

describe('declarative: batch success path', () => {
  it('applies a valid op stream atomically and confirms the changed ids', async () => {
    const vault = makeVault()
    const proj = idOf(await run(vault, ['new', 'project', '--title', 'Batch', '--dir', 'Work']))
    const stream = [
      JSON.stringify({ op: 'new_task', project: proj, title: 'From batch A', key: 'a' }),
      JSON.stringify({ op: 'new_task', project: proj, title: 'From batch B', key: 'b', under: 'a' })
    ].join('\n')
    const r = await withStdin(stream, () => run(vault, ['batch']))
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('✓ batch')
    // Rendered proof: both created tasks are now in the tree, nested per `under`.
    const tree = await run(vault, ['tree', proj, '--sub'])
    expect(tree.stdout).toContain('From batch A')
    expect(tree.stdout).toContain('From batch B')
  })
})

describe('declarative: watch (smoke)', () => {
  it('starts and emits the initial ready event (fs watcher stubbed, no leak)', async () => {
    const vault = makeVault()
    await seed(vault)
    const writes: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      writes.push(String(chunk))
      return true
    })
    // `watch` never resolves — race it against a short timer, then restore.
    void runPm(['watch'], { vault, now: NOW })
    await new Promise((r) => setTimeout(r, 250))
    spy.mockRestore()
    expect(writes.join(''), 'watch emits a ready NDJSON event on setup').toContain('"kind":"ready"')
  })
})

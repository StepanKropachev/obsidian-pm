// @vitest-environment node
//
// Colocated edge tests for the Wave B mutation surface: cycle rejection,
// dry-run write-suppression, reparenting, project folder move, and declarative
// apply idempotency + prune. Each test drives the CLI over a REAL temp-fs vault
// (the same honest SUT as cli/pm.test.ts) and asserts against bytes on disk.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseFrontmatter } from '../../../src/store'
import { runPm } from '../run'

const vaults: string[] = []

function makeVault(): string {
  const root = mkdtempSync(join(tmpdir(), 'pm-cli-mut-'))
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

function run(vault: string, argv: string[]) {
  return runPm(argv, { vault })
}

function fm(vault: string, rel: string): Record<string, unknown> {
  return parseFrontmatter(readFileSync(join(vault, rel), 'utf8')).frontmatter ?? {}
}

async function seedProject(vault: string, title = 'Proj', dir = 'Work'): Promise<string> {
  const p = await run(vault, ['new', 'project', '--title', title, '--dir', dir])
  return String((p.envelope.data ?? {}).id ?? '')
}

async function seedTask(vault: string, projectId: string, title: string, parentId?: string) {
  const argv = ['new', 'task', '--project', projectId, '--title', title]
  if (parentId) argv.push('--parent', parentId)
  const r = await run(vault, argv)
  return {
    id: String((r.envelope.data ?? {}).id ?? ''),
    filePath: String((r.envelope.data ?? {}).filePath ?? '')
  }
}

describe('depend cycle guard', () => {
  it('rejects an edge that would form a cycle with E_CYCLE (exit 5) and writes nothing', async () => {
    const vault = makeVault()
    const projectId = await seedProject(vault)
    const a = await seedTask(vault, projectId, 'Task A')
    const b = await seedTask(vault, projectId, 'Task B')

    // B depends on A — fine.
    const ok = await run(vault, ['depend', b.id, '--on', a.id])
    expect(ok.exitCode).toBe(0)
    expect(fm(vault, b.filePath).dependencies).toContain(a.id)

    // A depends on B — would close a cycle (A → B → A). Reject before writing.
    const cyc = await run(vault, ['depend', a.id, '--on', b.id])
    expect(cyc.exitCode, 'a cycle exits 5').toBe(5)
    expect(cyc.envelope.error?.code).toBe('E_CYCLE')
    expect(fm(vault, a.filePath).dependencies ?? [], 'nothing was written on the rejected edge').not.toContain(b.id)
  })
})

describe('shift --dry-run', () => {
  it('reports the move but writes nothing to disk', async () => {
    const vault = makeVault()
    const projectId = await seedProject(vault)
    const t = await run(vault, ['new', 'task', '--project', projectId, '--title', 'Dated', '--due', '2026-08-01'])
    const id = String((t.envelope.data ?? {}).id ?? '')
    const filePath = String((t.envelope.data ?? {}).filePath ?? '')

    const dry = await run(vault, ['shift', id, '+7d', '--dry-run'])
    expect(dry.exitCode).toBe(0)
    expect(dry.envelope.meta?.dry_run).toBe(true)
    expect(fm(vault, filePath).due, 'a dry-run shift must not move the due date on disk').toBe('2026-08-01')

    const real = await run(vault, ['shift', id, '+7d'])
    expect(real.exitCode).toBe(0)
    expect(fm(vault, filePath).due, 'a real shift moves the due date').toBe('2026-08-08')
  })
})

describe('shift cascade suppression (--no-cascade / --no-schedule)', () => {
  // A has a subtask (moves via subtree cascade) and a downstream dependent B
  // (moves only via the scheduler pass). The two flags carve the cascade apart.
  async function seedChain(vault: string) {
    const proj = await seedProject(vault)
    const a = await seedTask(vault, proj, 'A')
    const sub = await seedTask(vault, proj, 'A subtask', a.id)
    const b = await seedTask(vault, proj, 'B')
    await run(vault, ['set', a.id, 'due=2026-08-01'])
    await run(vault, ['set', sub.id, 'due=2026-08-01'])
    await run(vault, ['set', b.id, 'due=2026-08-02'])
    // Wire the dependency WITHOUT triggering the scheduler, so B stays at 2026-08-02
    // until the shift-under-test decides whether to reschedule it. (Also exercises
    // --no-schedule on `depend`.)
    await run(vault, ['depend', b.id, '--on', a.id, '--no-schedule'])
    return { a, sub, b }
  }

  it('POSITIVE CONTROL: a plain shift cascades to the subtree AND downstream dependents', async () => {
    const vault = makeVault()
    const { a, sub, b } = await seedChain(vault)
    await run(vault, ['shift', a.id, '+7d'])
    expect(fm(vault, a.filePath).due).toBe('2026-08-08')
    expect(fm(vault, sub.filePath).due, 'subtree moves with its parent').toBe('2026-08-08')
    expect(fm(vault, b.filePath).due, 'downstream dependent reschedules').not.toBe('2026-08-02')
  })

  it('--no-cascade moves ONLY the item — no subtree, no downstream', async () => {
    const vault = makeVault()
    const { a, sub, b } = await seedChain(vault)
    await run(vault, ['shift', a.id, '+7d', '--no-cascade'])
    expect(fm(vault, a.filePath).due, 'the item itself moves').toBe('2026-08-08')
    expect(fm(vault, sub.filePath).due, 'subtree is NOT moved under --no-cascade').toBe('2026-08-01')
    expect(fm(vault, b.filePath).due, 'downstream is NOT rescheduled under --no-cascade').toBe('2026-08-02')
  })

  it('--no-schedule moves item + subtree but skips the downstream scheduler pass', async () => {
    const vault = makeVault()
    const { a, sub, b } = await seedChain(vault)
    await run(vault, ['shift', a.id, '+7d', '--no-schedule'])
    expect(fm(vault, a.filePath).due, 'the item itself moves').toBe('2026-08-08')
    expect(fm(vault, sub.filePath).due, 'subtree still moves (it is part of the shift)').toBe('2026-08-08')
    expect(fm(vault, b.filePath).due, 'downstream is NOT rescheduled under --no-schedule').toBe('2026-08-02')
  })
})

describe('mv (reparent)', () => {
  it('reparents a task under a new parent', async () => {
    const vault = makeVault()
    const projectId = await seedProject(vault)
    const p1 = await seedTask(vault, projectId, 'Parent one')
    const p2 = await seedTask(vault, projectId, 'Parent two')
    const child = await seedTask(vault, projectId, 'Child', p1.id)

    const moved = await run(vault, ['mv', child.id, '--parent', p2.id])
    expect(moved.exitCode).toBe(0)
    expect((moved.envelope.data ?? {}).parentId).toBe(p2.id)

    // Re-read from disk: the child's frontmatter parentId points at the new parent.
    const projects = await run(vault, ['tree', p2.id, '--sub'])
    const nodes = ((projects.envelope.data ?? {}).nodes ?? []) as Array<{ id: string; parentId: string | null }>
    expect(nodes.find((n) => n.id === child.id)?.parentId).toBe(p2.id)
  })
})

describe('mv project --dir (folder move)', () => {
  it('moves the whole project folder to a new directory', async () => {
    const vault = makeVault()
    const projectId = await seedProject(vault, 'Movable', 'Work')
    await seedTask(vault, projectId, 'A task')
    expect(existsSync(join(vault, 'Work/Movable/Movable.md'))).toBe(true)

    const moved = await run(vault, ['mv', 'project', projectId, '--dir', 'Archive/Old'])
    expect(moved.exitCode).toBe(0)
    expect(existsSync(join(vault, 'Work/Movable/Movable.md')), 'the old location is gone').toBe(false)
    expect(existsSync(join(vault, 'Archive/Old/Movable/Movable.md')), 'the project moved under the new dir').toBe(true)
  })
})

describe('apply --prune', () => {
  it('archives a task dropped from the spec on a subsequent apply', async () => {
    const vault = makeVault()
    const specPath = join(vault, 'roadmap.pm.yaml')
    const full = [
      'project:',
      '  key: roadmap',
      '  title: Roadmap',
      '  dir: Work',
      'tasks:',
      '  - key: keep',
      '    title: Keep me',
      '  - key: drop',
      '    title: Drop me',
      ''
    ].join('\n')
    writeFileSync(specPath, full)

    const first = await run(vault, ['apply', specPath])
    expect(first.exitCode).toBe(0)
    expect((first.envelope.changed_ids ?? []).length).toBeGreaterThan(0)

    // Re-apply the identical spec — a no-op.
    const second = await run(vault, ['apply', specPath])
    expect((second.envelope.changed_ids ?? []).length, 'identical re-apply is a no-op').toBe(0)

    // Drop `drop` from the spec and re-apply with --prune → it is archived.
    const pruned = [
      'project:',
      '  key: roadmap',
      '  title: Roadmap',
      '  dir: Work',
      'tasks:',
      '  - key: keep',
      '    title: Keep me',
      ''
    ].join('\n')
    writeFileSync(specPath, pruned)
    const third = await run(vault, ['apply', specPath, '--prune'])
    expect(third.exitCode).toBe(0)
    expect((third.envelope.changed_ids ?? []).length, 'prune archives the dropped task').toBeGreaterThan(0)
    // The dropped task file now lives under an Archive/ folder.
    expect(
      existsSync(join(vault, 'Work/Roadmap/Roadmap_tasks/Archive')),
      'an Archive folder was created for the pruned task'
    ).toBe(true)
  })
})

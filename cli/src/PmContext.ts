// PmContext — one store instance per CLI invocation.
//
// Resolves the vault root, reads `PMSettings` from the vault's plugin `data.json`
// (merged over `DEFAULT_SETTINGS` exactly as `PMPlugin.loadSettings` does), and
// constructs `new ProjectStore(app, () => settings)` over the real-fs
// `NodeVaultAdapter`. This is the reuse thesis in one object: the UNMODIFIED
// plugin store, running on Node (R41).

import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { App } from 'obsidian'
import { ProjectStore } from '../../src/store'
import { today } from '../../src/dates'
import type { PMSettings, Project } from '../../src/types'
import { DEFAULT_SETTINGS } from '../../src/types'

const todayIso = (): string => today().toString()
import { makeNodeApp, type NodeApp, type NodeVault } from './NodeVaultAdapter'
import { PmError } from './envelope'

export interface PmContext {
  vaultRoot: string
  store: ProjectStore
  settings: PMSettings
  app: NodeApp
  vault: NodeVault
  /** Injectable "today" (YYYY-MM-DD) so date-bearing views are byte-deterministic in tests. */
  now: string
}

/**
 * Resolve the vault root: `--vault`/opts → `PM_VAULT` → walk up from `cwd` for a
 * `.obsidian/` directory → `E_NO_VAULT`.
 */
export function resolveVaultRoot(opts: { vault?: string; cwd?: string } = {}): string {
  // An empty `--vault ''` must NOT shadow PM_VAULT (`'' ?? env` would return '').
  const explicit = (opts.vault && opts.vault.length > 0 ? opts.vault : undefined) ?? process.env.PM_VAULT
  if (explicit) {
    const root = isAbsolute(explicit) ? explicit : resolve(opts.cwd ?? process.cwd(), explicit)
    if (!existsSync(root)) {
      throw new PmError('E_NO_VAULT', `Vault not found at ${root}`)
    }
    return root
  }
  let dir = resolve(opts.cwd ?? process.cwd())
  for (;;) {
    if (existsSync(join(dir, '.obsidian'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new PmError(
    'E_NO_VAULT',
    'No vault found. Pass --vault <path>, set PM_VAULT, or run inside a vault (a folder containing .obsidian/).'
  )
}

/** Read + merge `PMSettings` the same way `PMPlugin.loadSettings` does. */
export function loadSettings(vaultRoot: string): PMSettings {
  const dataPath = join(vaultRoot, '.obsidian', 'plugins', 'project-manager', 'data.json')
  let saved: Partial<PMSettings> | null = null
  if (existsSync(dataPath)) {
    try {
      saved = JSON.parse(readFileSync(dataPath, 'utf8')) as Partial<PMSettings>
    } catch {
      saved = null
    }
  }
  const settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {}) as PMSettings
  if (!saved?.statuses?.length) settings.statuses = DEFAULT_SETTINGS.statuses
  if (!saved?.priorities?.length) settings.priorities = DEFAULT_SETTINGS.priorities
  if (!settings.projectFilters) settings.projectFilters = {}
  if (!settings.collapsedTasks) settings.collapsedTasks = {}
  for (const s of settings.statuses) {
    if (s.complete === undefined) s.complete = s.id === 'done' || s.id === 'cancelled'
  }
  return settings
}

export async function createPmContext(opts: { vault: string; cwd?: string; now?: string }): Promise<PmContext> {
  const vaultRoot = resolveVaultRoot(opts)
  const settings = loadSettings(vaultRoot)
  const { app, vault } = makeNodeApp(vaultRoot)
  const store = new ProjectStore(app as unknown as App, () => settings)
  const now = opts.now ?? todayIso()
  return { vaultRoot, store, settings, app, vault, now }
}

/** Load every project in the vault (frontmatter-hydrated; bodies lazy). */
export async function loadAllProjects(ctx: PmContext): Promise<Project[]> {
  return ctx.store.discoverProjects()
}

// Production `obsidian` shim for the `pm` CLI.
//
// The plugin's `src/store/**` domain code imports a narrow slice of the
// `obsidian` module — `parseYaml`, `normalizePath`, `TFile`/`TFolder`/
// `TAbstractFile`, `Notice`, `setIcon`, and the `App`/`Plugin` types. None of it
// reaches for the DOM, the workspace, or Electron. This module supplies a
// real-runtime substitute so `ProjectStore` runs UNMODIFIED on Node.
//
// The `cli/tsconfig.json` `paths` alias points `obsidian` here for the CLI's own
// build/typecheck. Under vitest the global config aliases `obsidian` →
// `test/obsidian-stub.ts` instead, so the CLI and the store share the stub's
// classes in tests. Both are structurally identical; this is the production one.

import { parse } from 'yaml'

export const parseYaml = (raw: string): unknown => parse(raw)

export class Notice {
  constructor(_message?: string, _timeout?: number) {}
  hide(): void {}
  setMessage(_message: string): this {
    return this
  }
}

export function setIcon(_el?: unknown, _iconId?: string): void {}

/** Obsidian's `normalizePath`: POSIX slashes, collapse `//`, strip leading/trailing `/`. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

export function parseLinktext(linktext: string): { path: string; subpath: string } {
  const hash = linktext.indexOf('#')
  return hash < 0 ? { path: linktext, subpath: '' } : { path: linktext.slice(0, hash), subpath: linktext.slice(hash) }
}

export class TAbstractFile {
  path = ''
  name = ''
  parent: TFolder | null = null
}

export class TFile extends TAbstractFile {
  basename = ''
  extension = ''
  stat = { ctime: 0, mtime: 0, size: 0 }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = []
  isRoot(): boolean {
    return this.parent === null
  }
}

// ─── Type-only shims (erased at runtime; present so `tsc` resolves them) ───────

export type EventRef = unknown

/**
 * Structural stand-in for Obsidian's `App`. The three domain surfaces the store
 * uses are typed `any` so `this.app.vault.*` etc. compile against the shim — the
 * NodeVaultAdapter supplies the concrete implementations at runtime.
 */
export class App {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vault: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fileManager: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadataCache: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workspace: any
}

export class Plugin {
  registerEvent(_ref?: unknown): void {}
  registerInterval(id: number): number {
    return id
  }
}

export class MarkdownView {}

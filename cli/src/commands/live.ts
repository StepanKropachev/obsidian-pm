// Live verb (INT-019 §E): `watch` — the one long-lived command. A recursive
// `fs.watch` over the vault (no chokidar, no new dependency) routes each changed
// `.md` through the store's own external-change seams (`handleExternalTaskChange`
// / `handleExternalRename`) so the in-memory model stays live while a human edits
// in Obsidian, and emits one NDJSON change-event line per event. Runs until killed.

import { existsSync, watch } from 'node:fs'
import { join } from 'node:path'
import { TFile, normalizePath } from 'obsidian'
import type { PmContext } from '../PmContext'
import type { HandlerOutput } from '../envelope'
import type { ParsedCommand } from '../args'

/** Directories that never carry PM content. */
const SKIP = new Set(['.git', 'node_modules', '.trash', '.obsidian'])

/** A minimal TFile for `rel`: the live mirror entry when present, else synthesized. */
function fileFor(ctx: PmContext, rel: string): TFile {
  const existing = ctx.vault.getAbstractFileByPath(rel)
  if (existing instanceof TFile) return existing
  const f = new TFile()
  f.path = rel
  const slash = rel.lastIndexOf('/')
  const name = slash >= 0 ? rel.slice(slash + 1) : rel
  f.name = name
  const dot = name.lastIndexOf('.')
  f.basename = dot > 0 ? name.slice(0, dot) : name
  f.extension = dot > 0 ? name.slice(dot + 1) : ''
  return f
}

export async function watchCmd(ctx: PmContext, _cmd: ParsedCommand): Promise<HandlerOutput> {
  // Populate the project cache so `handleExternalTaskChange` can locate owners.
  await ctx.store.discoverProjects()

  const emit = (obj: Record<string, unknown>): void => {
    process.stdout.write(JSON.stringify(obj) + '\n')
  }
  emit({ kind: 'ready', path: ctx.vaultRoot })

  // Coalesce the burst of events an atomic (tmp-file + rename) write raises.
  const debounce = new Map<string, NodeJS.Timeout>()
  // A single recent-deletion slot, to pair a delete+create into one rename.
  let pendingDelete: { path: string; at: number } | null = null
  const RENAME_WINDOW_MS = 400

  const handle = (event: string, rel: string): void => {
    const path = normalizePath(rel)
    if (!path.endsWith('.md')) return
    if (path.split('/').some((seg) => SKIP.has(seg))) return

    const existing = existsSync(join(ctx.vaultRoot, path))
    void (async (): Promise<void> => {
      try {
        if (!existing) {
          // Vanished: record for a possible rename pairing, emit a delete event.
          pendingDelete = { path, at: Date.now() }
          emit({ kind: 'change', event: 'delete', path })
          return
        }
        // Appeared/changed. If a fresh deletion is pending, treat as a rename.
        if (event === 'rename' && pendingDelete && Date.now() - pendingDelete.at < RENAME_WINDOW_MS) {
          const oldPath = pendingDelete.path
          pendingDelete = null
          await ctx.store.handleExternalRename(oldPath, fileFor(ctx, path))
          emit({ kind: 'change', event: 'rename', from: oldPath, path })
          return
        }
        const task = await ctx.store.handleExternalTaskChange(fileFor(ctx, path))
        emit({ kind: 'change', event: event === 'rename' ? 'create' : 'change', id: task?.id, path })
      } catch (e) {
        emit({ kind: 'error', path, message: e instanceof Error ? e.message : String(e) })
      }
    })()
  }

  watch(ctx.vaultRoot, { recursive: true }, (event, filename) => {
    if (!filename) return
    const rel = String(filename)
    const key = `${event}:${rel}`
    const prev = debounce.get(key)
    if (prev) clearTimeout(prev)
    debounce.set(
      key,
      setTimeout(() => {
        debounce.delete(key)
        handle(event, rel)
      }, 40)
    )
  })

  // Long-lived: never resolves — the process streams until it is killed.
  return new Promise<HandlerOutput>(() => {})
}

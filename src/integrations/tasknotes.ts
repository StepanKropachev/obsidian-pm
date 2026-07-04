import type { App } from 'obsidian'
import type { PMSettings, PriorityConfig, StatusConfig } from '../types'

export interface TaskNotesStatus {
  id: string
  value: string
  label: string
  color: string
  isCompleted: boolean
  order: number
}

export interface TaskNotesPriority {
  id: string
  value: string
  label: string
  color: string
  weight: number
}

export interface TaskNotesDependency {
  uid: string
  reltype?: string
  gap?: string
}

/** A TaskNotes task as returned by its runtime API, with field names already normalized by their field mapping. */
export interface TaskNotesTaskInfo {
  path: string
  title: string
  status: string
  priority: string
  due?: string
  scheduled?: string
  timeEstimate?: number
  tags?: string[]
  projects?: string[]
  blockedBy?: Array<TaskNotesDependency | string>
  archived: boolean
  completedDate?: string
  dateCreated?: string
  dateModified?: string
  recurrence?: string
}

/** The slice of the TaskNotes runtime API v1 this plugin consumes. */
export interface TaskNotesApi {
  apiVersion: number
  hasCapability(capability: string): boolean
  getStatuses(): TaskNotesStatus[]
  getPriorities(): TaskNotesPriority[]
  getTask(path: string): Promise<TaskNotesTaskInfo | null>
  getSettingsSnapshot(): { taskTag?: string; fieldMapping?: Record<string, string> }
}

function getTaskNotesPlugin(app: App): { api?: unknown } | null {
  const registry = (app as App & { plugins?: { getPlugin?: (id: string) => unknown } }).plugins
  const plugin = registry?.getPlugin?.('tasknotes')
  return plugin && typeof plugin === 'object' ? plugin : null
}

/** True when the TaskNotes plugin is installed and enabled, regardless of its version. */
export function isTaskNotesInstalled(app: App): boolean {
  return getTaskNotesPlugin(app) !== null
}

/** The TaskNotes runtime API, or null when the plugin is missing or predates API v1 (TaskNotes 4.10). */
export function getTaskNotesApi(app: App): TaskNotesApi | null {
  const api = getTaskNotesPlugin(app)?.api as TaskNotesApi | undefined
  if (!api || api.apiVersion !== 1 || !api.hasCapability('catalog.read')) return null
  return api
}

/**
 * Upsert one ordered TaskNotes palette into ours. Entries with a matching id are
 * patched in place; missing entries are inserted right after the last TaskNotes
 * entry we matched, so relative TaskNotes order carries over without disturbing
 * entries TaskNotes doesn't know.
 */
function upsertPalette<T extends { id: string }>(
  target: T[],
  incoming: Array<{ id: string; make: () => T; patch: (existing: T) => boolean }>
): { added: number; updated: number } {
  let added = 0
  let updated = 0
  let anchor = -1
  for (const item of incoming) {
    const idx = target.findIndex((cfg) => cfg.id === item.id)
    if (idx >= 0) {
      anchor = idx
      if (item.patch(target[idx])) updated++
    } else {
      anchor += 1
      target.splice(anchor, 0, item.make())
      added++
    }
  }
  return { added, updated }
}

/**
 * Resolve a TaskNotes reference (a "[[wikilink]]" or a plain vault path) to a
 * vault file path, or null when it doesn't resolve.
 */
export function resolveTaskNotesRef(app: App, ref: string, sourcePath: string): string | null {
  const inner = ref.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].split('#')[0].trim()
  if (!inner) return null
  if (app.vault.getFileByPath(inner)) return inner
  return app.metadataCache.getFirstLinkpathDest(inner, sourcePath)?.path ?? null
}

/**
 * Add palette entries (appended at the end) for TaskNotes status/priority values
 * that imported tasks use but our settings don't define yet, so those tasks stay
 * visible in status-driven views. Returns how many entries were added.
 */
export function ensurePaletteEntries(
  api: TaskNotesApi,
  settings: PMSettings,
  statusValues: Set<string>,
  priorityValues: Set<string>
): number {
  let added = 0
  for (const s of api.getStatuses()) {
    if (statusValues.has(s.value) && !settings.statuses.some((cfg) => cfg.id === s.value)) {
      settings.statuses.push({ id: s.value, label: s.label, color: s.color, icon: '', complete: s.isCompleted })
      added++
    }
  }
  for (const p of api.getPriorities()) {
    if (priorityValues.has(p.value) && !settings.priorities.some((cfg) => cfg.id === p.value)) {
      settings.priorities.push({ id: p.value, label: p.label, color: p.color, icon: '' })
      added++
    }
  }
  return added
}

/** Upsert TaskNotes' configured statuses and priorities into our palettes. */
export function importTaskNotesPalettes(api: TaskNotesApi, settings: PMSettings): { added: number; updated: number } {
  const statuses = upsertPalette(
    settings.statuses,
    [...api.getStatuses()]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        id: s.value,
        make: () => ({ id: s.value, label: s.label, color: s.color, icon: '', complete: s.isCompleted }),
        patch: (existing: StatusConfig) => {
          if (existing.label === s.label && existing.color === s.color && existing.complete === s.isCompleted) {
            return false
          }
          existing.label = s.label
          existing.color = s.color
          existing.complete = s.isCompleted
          return true
        }
      }))
  )

  const priorities = upsertPalette(
    settings.priorities,
    [...api.getPriorities()]
      .sort((a, b) => b.weight - a.weight)
      .map((p) => ({
        id: p.value,
        make: () => ({ id: p.value, label: p.label, color: p.color, icon: '' }),
        patch: (existing: PriorityConfig) => {
          if (existing.label === p.label && existing.color === p.color) return false
          existing.label = p.label
          existing.color = p.color
          return true
        }
      }))
  )

  return { added: statuses.added + priorities.added, updated: statuses.updated + priorities.updated }
}

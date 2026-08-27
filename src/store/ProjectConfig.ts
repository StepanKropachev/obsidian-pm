import type { CustomFieldDef, PMSettings, Project, ResolvedProjectConfig, Task } from '../types'
import { flattenTasks } from './TaskTreeOps'

const FALLBACK_COLOR = '#8a94a0'

/**
 * The project's own overrides where defined, the global settings everywhere else. Values
 * tasks still use but neither list defines are appended, so nothing vanishes from a board
 * or picker. Read every palette through this, terminal-status checks included: an
 * overridden status carries its own `complete` flag.
 *
 * Custom fields resolve down a chain instead of one override: the vault list, then each
 * ancestor project root-most first, then the project's own. `ancestorFields` carries the
 * ancestors in that order.
 */
export function resolveProjectConfig(
  project: Project,
  settings: PMSettings,
  ancestorFields: CustomFieldDef[][] = []
): ResolvedProjectConfig {
  const config = project.config
  return {
    customFields: resolveCustomFields(project, settings, ancestorFields),
    statuses: withInUseExtras(
      config?.statuses?.length ? config.statuses : settings.statuses,
      settings.statuses,
      project,
      (task) => task.status,
      (id) => ({ id, label: id, color: FALLBACK_COLOR, icon: '', complete: false })
    ),
    priorities: withInUseExtras(
      config?.priorities?.length ? config.priorities : settings.priorities,
      settings.priorities,
      project,
      (task) => task.priority,
      (id) => ({ id, label: id, color: FALLBACK_COLOR, icon: '' })
    ),
    priorityIcons: config?.priorityIcons ?? settings.priorityIcons,
    defaultView: config?.defaultView ?? settings.defaultView,
    autoSchedule: config?.autoSchedule ?? settings.autoSchedule,
    pullForwardOnEarlyFinish: config?.pullForwardOnEarlyFinish ?? settings.pullForwardOnEarlyFinish,
    autoArchiveDays: config?.autoArchiveDays ?? settings.autoArchiveDays,
    showSubtreeConnections: config?.showSubtreeConnections ?? settings.showSubtreeConnections,
    lineBorders: config?.lineBorders ?? settings.lineBorders,
    kanbanShowSubtasks: config?.kanbanShowSubtasks ?? settings.kanbanShowSubtasks,
    kanbanShowDescriptionPreview: config?.kanbanShowDescriptionPreview ?? settings.kanbanShowDescriptionPreview
  }
}

/**
 * Later lists win on a repeated id, keeping the position the first one gave it, so a child
 * renaming an inherited field doesn't move its column. The lists run outermost first.
 */
export function mergeById<T extends { id: string }>(lists: T[][]): T[] {
  const merged: T[] = []
  const positions = new Map<string, number>()
  for (const list of lists) {
    for (const entry of list) {
      const at = positions.get(entry.id)
      if (at === undefined) {
        positions.set(entry.id, merged.length)
        merged.push(entry)
      } else {
        merged[at] = entry
      }
    }
  }
  return merged
}

/** Ids the project lists as hidden drop out, unless it declares them itself. */
function resolveCustomFields(
  project: Project,
  settings: PMSettings,
  ancestorFields: CustomFieldDef[][]
): CustomFieldDef[] {
  const fields = mergeById([settings.customFields, ...ancestorFields, project.customFields])
  const hidden = project.config?.hiddenCustomFields
  if (!hidden?.length) return fields
  const own = new Set(project.customFields.map((field) => field.id))
  return fields.filter((field) => own.has(field.id) || !hidden.includes(field.id))
}

function withInUseExtras<T extends { id: string }>(
  own: T[],
  global: T[],
  project: Project,
  valueOf: (task: Task) => string,
  makeFallback: (id: string) => T
): T[] {
  const known = new Set(own.map((entry) => entry.id))
  let extras: T[] | null = null
  for (const { task } of flattenTasks(project.tasks)) {
    const id = valueOf(task)
    if (known.has(id)) continue
    known.add(id)
    extras ??= []
    extras.push(global.find((entry) => entry.id === id) ?? makeFallback(id))
  }
  return extras ? [...own, ...extras] : own
}

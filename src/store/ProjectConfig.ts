import type { PMSettings, Project, ResolvedProjectConfig, Task } from '../types'
import { flattenTasks } from './TaskTreeOps'

const FALLBACK_COLOR = '#8a94a0'

/**
 * The project's own overrides where defined, the global settings everywhere else. Values
 * tasks still use but neither list defines are appended, so nothing vanishes from a board
 * or picker. Read every palette through this, terminal-status checks included: an
 * overridden status carries its own `complete` flag.
 */
export function resolveProjectConfig(project: Project, settings: PMSettings): ResolvedProjectConfig {
  const config = project.config
  return {
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
    showSubtreeConnections: config?.showSubtreeConnections ?? settings.showSubtreeConnections,
    lineBorders: config?.lineBorders ?? settings.lineBorders,
    kanbanShowSubtasks: config?.kanbanShowSubtasks ?? settings.kanbanShowSubtasks,
    kanbanShowDescriptionPreview: config?.kanbanShowDescriptionPreview ?? settings.kanbanShowDescriptionPreview
  }
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

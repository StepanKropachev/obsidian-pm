import type { PMSettings, Project, ResolvedProjectConfig, Task } from '../types'
import { flattenTasks } from './TaskTreeOps'

const FALLBACK_COLOR = '#8a94a0'

/**
 * Resolve the configuration in effect for a project: its own overrides where
 * defined, the global settings everywhere else. Status and priority values
 * that tasks still use but neither list defines are appended (borrowing the
 * global config when one exists) so nothing disappears from boards or
 * pickers. Use this everywhere a project's tasks are interpreted, including
 * terminal-status checks: an overridden status carries its own `complete` flag.
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
    defaultView: config?.defaultView ?? settings.defaultView,
    autoSchedule: config?.autoSchedule ?? settings.autoSchedule,
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

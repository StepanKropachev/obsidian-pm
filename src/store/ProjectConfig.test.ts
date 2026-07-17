import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRIORITIES,
  DEFAULT_SETTINGS,
  DEFAULT_STATUSES,
  makeProject,
  makeTask,
  type PriorityConfig,
  type ProjectConfig,
  type StatusConfig
} from '../types'
import { resolveProjectConfig } from './ProjectConfig'

const CUSTOM_STATUSES: StatusConfig[] = [
  { id: 'idea', label: 'Idea', color: '#888', icon: '', complete: false },
  { id: 'shipped', label: 'Shipped', color: '#0a0', icon: '', complete: true }
]

const CUSTOM_PRIORITIES: PriorityConfig[] = [
  { id: 'urgent', label: 'Urgent', color: '#f00', icon: '' },
  { id: 'later', label: 'Later', color: '#888', icon: '' }
]

function makeOverrideProject(config?: ProjectConfig) {
  const project = makeProject('P', 'Projects/P.md')
  project.config = config
  return project
}

describe('resolveProjectConfig', () => {
  it('inherits everything from the global settings when the project overrides nothing', () => {
    const resolved = resolveProjectConfig(makeOverrideProject(), DEFAULT_SETTINGS)
    expect(resolved.statuses).toEqual(DEFAULT_STATUSES)
    expect(resolved.priorities).toEqual(DEFAULT_PRIORITIES)
    expect(resolved.defaultView).toBe(DEFAULT_SETTINGS.defaultView)
    expect(resolved.autoSchedule).toBe(DEFAULT_SETTINGS.autoSchedule)
    expect(resolved.kanbanShowSubtasks).toBe(DEFAULT_SETTINGS.kanbanShowSubtasks)
    expect(resolved.kanbanShowDescriptionPreview).toBe(DEFAULT_SETTINGS.kanbanShowDescriptionPreview)
  })

  it('treats empty override lists as inherit', () => {
    const resolved = resolveProjectConfig(makeOverrideProject({ statuses: [], priorities: [] }), DEFAULT_SETTINGS)
    expect(resolved.statuses).toEqual(DEFAULT_STATUSES)
    expect(resolved.priorities).toEqual(DEFAULT_PRIORITIES)
  })

  it('uses the project-defined statuses and priorities when present', () => {
    const resolved = resolveProjectConfig(
      makeOverrideProject({ statuses: CUSTOM_STATUSES, priorities: CUSTOM_PRIORITIES }),
      DEFAULT_SETTINGS
    )
    expect(resolved.statuses.map((s) => s.id)).toEqual(['idea', 'shipped'])
    expect(resolved.statuses[1].complete).toBe(true)
    expect(resolved.priorities.map((p) => p.id)).toEqual(['urgent', 'later'])
  })

  it('overrides behavior settings independently of the palettes', () => {
    const resolved = resolveProjectConfig(
      makeOverrideProject({ defaultView: 'kanban', autoSchedule: false, kanbanShowSubtasks: true }),
      DEFAULT_SETTINGS
    )
    expect(resolved.defaultView).toBe('kanban')
    expect(resolved.autoSchedule).toBe(false)
    expect(resolved.kanbanShowSubtasks).toBe(true)
    expect(resolved.statuses).toEqual(DEFAULT_STATUSES)
    expect(resolved.kanbanShowDescriptionPreview).toBe(DEFAULT_SETTINGS.kanbanShowDescriptionPreview)
  })

  it('borrows the global config for in-use statuses the project does not define', () => {
    const project = makeOverrideProject({ statuses: CUSTOM_STATUSES })
    project.tasks.push(makeTask({ status: 'done' }))
    const resolved = resolveProjectConfig(project, DEFAULT_SETTINGS)
    expect(resolved.statuses.map((s) => s.id)).toEqual(['idea', 'shipped', 'done'])
    // The borrowed entry keeps its global complete flag, so terminal checks stay correct.
    expect(resolved.statuses.find((s) => s.id === 'done')?.complete).toBe(true)
  })

  it('borrows the global config for in-use priorities the project does not define', () => {
    const project = makeOverrideProject({ priorities: CUSTOM_PRIORITIES })
    project.tasks.push(makeTask({ priority: 'high' }))
    const resolved = resolveProjectConfig(project, DEFAULT_SETTINGS)
    expect(resolved.priorities.map((p) => p.id)).toEqual(['urgent', 'later', 'high'])
  })

  it('re-derives a materialized block from the global palette (marker ⇒ not an override)', () => {
    // A materialized snapshot carries the resolved palette but must NOT win as an
    // override: the resolver ignores it and re-derives from the global settings so
    // later global-palette edits re-propagate on the next save.
    const resolved = resolveProjectConfig(
      makeOverrideProject({ statuses: CUSTOM_STATUSES, priorities: CUSTOM_PRIORITIES, materialized: true }),
      DEFAULT_SETTINGS
    )
    expect(resolved.statuses).toEqual(DEFAULT_STATUSES)
    expect(resolved.priorities).toEqual(DEFAULT_PRIORITIES)
  })

  it('honors a genuine override (no materialized marker) over the global palette', () => {
    const resolved = resolveProjectConfig(
      makeOverrideProject({ statuses: CUSTOM_STATUSES, materialized: false }),
      DEFAULT_SETTINGS
    )
    expect(resolved.statuses.map((s) => s.id)).toEqual(['idea', 'shipped'])
  })

  it('synthesizes a placeholder for in-use values nobody defines', () => {
    const project = makeOverrideProject()
    const parent = makeTask({ status: 'todo' })
    parent.subtasks.push(makeTask({ status: 'mystery', priority: 'whenever' }))
    project.tasks.push(parent)
    const resolved = resolveProjectConfig(project, DEFAULT_SETTINGS)
    expect(resolved.statuses.find((s) => s.id === 'mystery')).toEqual({
      id: 'mystery',
      label: 'mystery',
      color: '#8a94a0',
      icon: '',
      complete: false
    })
    expect(resolved.priorities.find((p) => p.id === 'whenever')).toEqual({
      id: 'whenever',
      label: 'whenever',
      color: '#8a94a0',
      icon: ''
    })
  })
})

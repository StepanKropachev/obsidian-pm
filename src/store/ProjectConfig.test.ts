import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRIORITIES,
  DEFAULT_SETTINGS,
  DEFAULT_STATUSES,
  makeProject,
  makeTask,
  type CustomFieldDef,
  type PMSettings,
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
    expect(resolved.priorityIcons).toBe(DEFAULT_SETTINGS.priorityIcons)
    expect(resolved.autoSchedule).toBe(DEFAULT_SETTINGS.autoSchedule)
    expect(resolved.pullForwardOnEarlyFinish).toBe(DEFAULT_SETTINGS.pullForwardOnEarlyFinish)
    expect(resolved.showSubtreeConnections).toBe(DEFAULT_SETTINGS.showSubtreeConnections)
    expect(resolved.lineBorders).toBe(DEFAULT_SETTINGS.lineBorders)
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
      makeOverrideProject({
        defaultView: 'kanban',
        priorityIcons: 'signal',
        autoSchedule: false,
        pullForwardOnEarlyFinish: true,
        showSubtreeConnections: false,
        lineBorders: 'both',
        kanbanShowSubtasks: true
      }),
      DEFAULT_SETTINGS
    )
    expect(resolved.defaultView).toBe('kanban')
    expect(resolved.priorityIcons).toBe('signal')
    expect(resolved.autoSchedule).toBe(false)
    expect(resolved.pullForwardOnEarlyFinish).toBe(true)
    expect(resolved.showSubtreeConnections).toBe(false)
    expect(resolved.lineBorders).toBe('both')
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

const VAULT_FIELD: CustomFieldDef = { id: 'cf-budget', name: 'Budget', type: 'number' }
const PARENT_FIELD: CustomFieldDef = { id: 'cf-owner', name: 'Owner', type: 'person' }
const CHILD_FIELD: CustomFieldDef = { id: 'cf-sprint', name: 'Sprint', type: 'text' }

function withVaultFields(...customFields: CustomFieldDef[]): PMSettings {
  return { ...DEFAULT_SETTINGS, customFields }
}

describe('resolveProjectConfig custom fields', () => {
  it('is only the project own fields when nothing above it defines any', () => {
    const project = makeOverrideProject()
    project.customFields.push(CHILD_FIELD)
    expect(resolveProjectConfig(project, DEFAULT_SETTINGS).customFields).toEqual([CHILD_FIELD])
  })

  it('takes the vault fields and the ancestors, outermost first', () => {
    const project = makeOverrideProject()
    project.customFields.push(CHILD_FIELD)
    const resolved = resolveProjectConfig(project, withVaultFields(VAULT_FIELD), [[PARENT_FIELD]])
    expect(resolved.customFields).toEqual([VAULT_FIELD, PARENT_FIELD, CHILD_FIELD])
  })

  it('keeps one entry per id, so a parent and its child contribute one field', () => {
    const project = makeOverrideProject()
    const resolved = resolveProjectConfig(project, DEFAULT_SETTINGS, [[PARENT_FIELD], [PARENT_FIELD]])
    expect(resolved.customFields).toEqual([PARENT_FIELD])
  })

  it('lets the project override an inherited field without moving it', () => {
    const project = makeOverrideProject()
    const renamed: CustomFieldDef = { ...PARENT_FIELD, name: 'Accountable' }
    project.customFields.push(CHILD_FIELD, renamed)
    const resolved = resolveProjectConfig(project, DEFAULT_SETTINGS, [[PARENT_FIELD]])
    expect(resolved.customFields).toEqual([renamed, CHILD_FIELD])
  })

  it('takes the nearest declaration when the vault and several ancestors define one field', () => {
    const grandparent: CustomFieldDef = { ...VAULT_FIELD, name: 'Cost' }
    const parent: CustomFieldDef = { ...VAULT_FIELD, name: 'Spend' }
    const resolved = resolveProjectConfig(makeOverrideProject(), withVaultFields(VAULT_FIELD), [
      [grandparent],
      [parent]
    ])
    expect(resolved.customFields).toEqual([parent])
  })

  it('leaves out an inherited field the project hides', () => {
    const project = makeOverrideProject({ hiddenCustomFields: [PARENT_FIELD.id] })
    const resolved = resolveProjectConfig(project, DEFAULT_SETTINGS, [[PARENT_FIELD, CHILD_FIELD]])
    expect(resolved.customFields).toEqual([CHILD_FIELD])
  })

  it('keeps a hidden field the project also declares itself', () => {
    const project = makeOverrideProject({ hiddenCustomFields: [PARENT_FIELD.id] })
    project.customFields.push(PARENT_FIELD)
    expect(resolveProjectConfig(project, DEFAULT_SETTINGS, [[PARENT_FIELD]]).customFields).toEqual([PARENT_FIELD])
  })
})

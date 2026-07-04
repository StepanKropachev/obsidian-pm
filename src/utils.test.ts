import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUSES, makeProject, makeTask, type StatusConfig } from './types'
import { projectStatuses } from './utils'

const CUSTOM: StatusConfig[] = [
  { id: 'idea', label: 'Idea', color: '#888', icon: '', complete: false },
  { id: 'shipped', label: 'Shipped', color: '#0a0', icon: '', complete: true }
]

function makeOverrideProject(statuses?: StatusConfig[]) {
  const project = makeProject('P', 'Projects/P.md')
  project.statuses = statuses
  return project
}

describe('projectStatuses', () => {
  it('inherits the global statuses when the project defines none', () => {
    expect(projectStatuses(makeOverrideProject(), DEFAULT_STATUSES)).toEqual(DEFAULT_STATUSES)
    expect(projectStatuses(makeOverrideProject([]), DEFAULT_STATUSES)).toEqual(DEFAULT_STATUSES)
  })

  it('uses the project-defined statuses when present', () => {
    const result = projectStatuses(makeOverrideProject(CUSTOM), DEFAULT_STATUSES)
    expect(result.map((s) => s.id)).toEqual(['idea', 'shipped'])
    expect(result[1].complete).toBe(true)
  })

  it('borrows the global config for in-use statuses the project does not define', () => {
    const project = makeOverrideProject(CUSTOM)
    project.tasks.push(makeTask({ status: 'done' }))
    const result = projectStatuses(project, DEFAULT_STATUSES)
    expect(result.map((s) => s.id)).toEqual(['idea', 'shipped', 'done'])
    // The borrowed entry keeps its global complete flag, so terminal checks stay correct.
    expect(result.find((s) => s.id === 'done')?.complete).toBe(true)
  })

  it('synthesizes a placeholder for in-use statuses nobody defines', () => {
    const project = makeOverrideProject()
    const parent = makeTask({ status: 'todo' })
    parent.subtasks.push(makeTask({ status: 'mystery' }))
    project.tasks.push(parent)
    const result = projectStatuses(project, DEFAULT_STATUSES)
    const placeholder = result.find((s) => s.id === 'mystery')
    expect(placeholder).toEqual({ id: 'mystery', label: 'mystery', color: '#8a94a0', icon: '', complete: false })
  })
})

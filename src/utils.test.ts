import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUSES, makeProject, makeTask } from './types'
import { projectStatuses } from './utils'

function makeSubsetProject(enabled?: string[]) {
  const project = makeProject('P', 'Projects/P.md')
  project.enabledStatuses = enabled
  return project
}

describe('projectStatuses', () => {
  it('returns all global statuses when the project has no selection', () => {
    expect(projectStatuses(makeSubsetProject(), DEFAULT_STATUSES)).toEqual(DEFAULT_STATUSES)
    expect(projectStatuses(makeSubsetProject([]), DEFAULT_STATUSES)).toEqual(DEFAULT_STATUSES)
  })

  it('filters to the enabled subset in global order', () => {
    const result = projectStatuses(makeSubsetProject(['done', 'todo']), DEFAULT_STATUSES)
    expect(result.map((s) => s.id)).toEqual(['todo', 'done'])
  })

  it('keeps statuses that tasks still use even when disabled', () => {
    const project = makeSubsetProject(['todo', 'done'])
    project.tasks.push(makeTask({ status: 'blocked' }))
    const result = projectStatuses(project, DEFAULT_STATUSES)
    expect(result.map((s) => s.id)).toEqual(['todo', 'blocked', 'done'])
  })

  it('checks subtask statuses too', () => {
    const project = makeSubsetProject(['todo'])
    const parent = makeTask({ status: 'todo' })
    parent.subtasks.push(makeTask({ status: 'review' }))
    project.tasks.push(parent)
    const result = projectStatuses(project, DEFAULT_STATUSES)
    expect(result.map((s) => s.id)).toEqual(['todo', 'review'])
  })
})

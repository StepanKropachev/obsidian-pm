import { describe, expect, it } from 'vitest'
import { makeProject, makeTask, type Project, type Task } from '../types'
import type { TaskRef } from './VaultIndex'
import { collectArchivable, withoutBlockedDependents } from './ArchiveOps'

const isComplete = (status: string): boolean => status === 'done'

function project(tasks: Task[]): Project {
  const p = makeProject('Roadmap', 'Projects/Roadmap.md')
  p.tasks = tasks
  return p
}

function done(id: string, completed: string, overrides: Partial<Task> = {}): Task {
  return makeTask({ id, title: id, status: 'done', completed, ...overrides })
}

function ref(id: string, dependencies: string[], archived = false): TaskRef {
  return {
    id,
    path: `Projects/Roadmap_tasks/${id}.md`,
    projectId: 'p1',
    projectPath: 'Projects/Roadmap.md',
    title: id,
    status: 'todo',
    priority: 'medium',
    start: '',
    due: '',
    completed: '',
    dependencies,
    assignees: [],
    archived
  }
}

const index = (refs: TaskRef[]) => ({ allTaskRefs: () => refs })

describe('collectArchivable', () => {
  it('picks tasks completed on or before the cutoff', () => {
    const p = project([done('old', '2026-08-01'), done('fresh', '2026-08-20')])

    expect(collectArchivable(p, isComplete, '2026-08-10')).toEqual([{ rootId: 'old', ids: ['old'] }])
  })

  it('leaves a completed task carrying no completion date', () => {
    const p = project([done('undated', '')])

    expect(collectArchivable(p, isComplete, '2026-08-10')).toEqual([])
  })

  it('leaves a task whose status is not complete', () => {
    const p = project([makeTask({ id: 'open', status: 'in-progress', completed: '2026-08-01' })])

    expect(collectArchivable(p, isComplete, '2026-08-10')).toEqual([])
  })

  it('keeps a whole subtree in place when one descendant is still live', () => {
    const p = project([
      done('parent', '2026-08-01', {
        subtasks: [done('child', '2026-08-01'), makeTask({ id: 'live', status: 'todo' })]
      })
    ])

    expect(collectArchivable(p, isComplete, '2026-08-10')).toEqual([])
  })

  it('takes the subtree with its root and reports every task that moves', () => {
    const p = project([done('parent', '2026-08-01', { subtasks: [done('child', '2026-08-02')] })])

    expect(collectArchivable(p, isComplete, '2026-08-10')).toEqual([{ rootId: 'parent', ids: ['parent', 'child'] }])
  })

  it('counts an already archived descendant as settled without moving it again', () => {
    const p = project([done('parent', '2026-08-01', { subtasks: [done('child', '', { archived: true })] })])

    expect(collectArchivable(p, isComplete, '2026-08-10')).toEqual([{ rootId: 'parent', ids: ['parent'] }])
  })

  it('skips a root that is already archived', () => {
    const p = project([done('gone', '2026-08-01', { archived: true })])

    expect(collectArchivable(p, isComplete, '2026-08-10')).toEqual([])
  })
})

describe('withoutBlockedDependents', () => {
  const candidate = (rootId: string, ids = [rootId]) => ({ rootId, ids })

  it('drops a task a live one still depends on', () => {
    const kept = withoutBlockedDependents([candidate('a')], index([ref('a', []), ref('open', ['a'])]))

    expect(kept).toEqual([])
  })

  it('keeps a task whose dependents are archived', () => {
    const kept = withoutBlockedDependents([candidate('a')], index([ref('a', []), ref('gone', ['a'], true)]))

    expect(kept).toEqual([candidate('a')])
  })

  it('keeps predecessor and dependent when both are archived in the same pass', () => {
    const kept = withoutBlockedDependents([candidate('a'), candidate('b')], index([ref('a', []), ref('b', ['a'])]))

    expect(kept.map((c) => c.rootId)).toEqual(['a', 'b'])
  })

  it('drops a predecessor when the task waiting on it is dropped first', () => {
    const kept = withoutBlockedDependents(
      [candidate('a'), candidate('b')],
      index([ref('a', []), ref('b', ['a']), ref('open', ['b'])])
    )

    expect(kept).toEqual([])
  })

  it('protects a dependency pointing into the middle of a moving subtree', () => {
    const kept = withoutBlockedDependents(
      [candidate('parent', ['parent', 'child'])],
      index([ref('parent', []), ref('child', []), ref('open', ['child'])])
    )

    expect(kept).toEqual([])
  })
})

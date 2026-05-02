import { describe, expect, it } from 'vitest'
import { applyTaskFilter, applyTaskFilterFlat, countActiveFilters, isFilterActive, matchesFilter } from './TaskFilter'
import { flattenTasks } from './TaskTreeOps'
import { DEFAULT_STATUSES, makeDefaultFilter, makeTask, type FilterState, type Task } from '../types'

function task(overrides: Partial<Task> & { id: string }): Task {
  return makeTask(overrides)
}

function filter(overrides: Partial<FilterState> = {}): FilterState {
  return { ...makeDefaultFilter(), ...overrides }
}

describe('isFilterActive', () => {
  it('returns false for the default filter', () => {
    expect(isFilterActive(makeDefaultFilter())).toBe(false)
  })

  it('returns true when text is set', () => {
    expect(isFilterActive(filter({ text: 'foo' }))).toBe(true)
  })

  it('returns true when any list filter has entries', () => {
    expect(isFilterActive(filter({ statuses: ['todo'] }))).toBe(true)
    expect(isFilterActive(filter({ priorities: ['high'] }))).toBe(true)
    expect(isFilterActive(filter({ assignees: ['alice'] }))).toBe(true)
    expect(isFilterActive(filter({ tags: ['urgent'] }))).toBe(true)
  })

  it('returns true when dueDateFilter is not "any"', () => {
    expect(isFilterActive(filter({ dueDateFilter: 'overdue' }))).toBe(true)
  })

  it('ignores showArchived (matches legacy semantics)', () => {
    expect(isFilterActive(filter({ showArchived: true }))).toBe(false)
  })
})

describe('countActiveFilters', () => {
  it('counts each active filter once', () => {
    expect(countActiveFilters(makeDefaultFilter())).toBe(0)
    expect(
      countActiveFilters(
        filter({
          text: 'x',
          statuses: ['todo'],
          priorities: ['high'],
          assignees: ['a'],
          tags: ['t'],
          dueDateFilter: 'overdue',
          showArchived: true
        })
      )
    ).toBe(7)
  })

  it('counts showArchived', () => {
    expect(countActiveFilters(filter({ showArchived: true }))).toBe(1)
  })
})

describe('matchesFilter', () => {
  it('hides archived tasks when showArchived is false', () => {
    const t = task({ id: 'a', archived: true })
    expect(matchesFilter(t, filter())).toBe(false)
    expect(matchesFilter(t, filter({ showArchived: true }))).toBe(true)
  })

  it('matches text against title, status, priority, assignees, and tags', () => {
    const t = task({ id: 'a', title: 'Refactor parser', assignees: ['Bob'], tags: ['cleanup'] })
    expect(matchesFilter(t, filter({ text: 'parser' }))).toBe(true)
    expect(matchesFilter(t, filter({ text: 'BOB' }))).toBe(true)
    expect(matchesFilter(t, filter({ text: 'cleanup' }))).toBe(true)
    expect(matchesFilter(t, filter({ text: 'unrelated' }))).toBe(false)
  })

  it('filters by status, priority, assignees, tags', () => {
    const t = task({ id: 'a', status: 'in-progress', priority: 'high', assignees: ['Alice'], tags: ['x'] })
    expect(matchesFilter(t, filter({ statuses: ['in-progress'] }))).toBe(true)
    expect(matchesFilter(t, filter({ statuses: ['done'] }))).toBe(false)
    expect(matchesFilter(t, filter({ priorities: ['high'] }))).toBe(true)
    expect(matchesFilter(t, filter({ priorities: ['low'] }))).toBe(false)
    expect(matchesFilter(t, filter({ assignees: ['Alice'] }))).toBe(true)
    expect(matchesFilter(t, filter({ assignees: ['Bob'] }))).toBe(false)
    expect(matchesFilter(t, filter({ tags: ['x'] }))).toBe(true)
    expect(matchesFilter(t, filter({ tags: ['y'] }))).toBe(false)
  })

  it('treats no-date dueDateFilter correctly', () => {
    expect(matchesFilter(task({ id: 'a', due: '' }), filter({ dueDateFilter: 'no-date' }))).toBe(true)
    expect(matchesFilter(task({ id: 'b', due: '2026-01-01' }), filter({ dueDateFilter: 'no-date' }))).toBe(false)
  })
})

describe('applyTaskFilter (tree-shaped)', () => {
  it('keeps tasks that match and rebuilds subtask trees', () => {
    const tasks = [
      task({ id: 'a', status: 'todo', subtasks: [task({ id: 'a1', status: 'todo' })] }),
      task({ id: 'b', status: 'done' })
    ]
    const out = applyTaskFilter(tasks, filter({ statuses: ['todo'] }), DEFAULT_STATUSES)
    expect(out.map((t) => t.id)).toEqual(['a'])
    expect(out[0].subtasks.map((t) => t.id)).toEqual(['a1'])
  })

  it('drops the entire subtree when the parent is filtered out (strict tree)', () => {
    const tasks = [task({ id: 'a', status: 'done', subtasks: [task({ id: 'a1', status: 'todo' })] })]
    const out = applyTaskFilter(tasks, filter({ statuses: ['todo'] }), DEFAULT_STATUSES)
    expect(out).toEqual([])
  })

  it('does not mutate the input tree', () => {
    const child = task({ id: 'a1', status: 'done' })
    const parent = task({ id: 'a', status: 'todo', subtasks: [child] })
    const out = applyTaskFilter([parent], filter({ statuses: ['todo'] }), DEFAULT_STATUSES)
    expect(parent.subtasks).toEqual([child])
    expect(out[0].subtasks).toEqual([])
  })
})

describe('applyTaskFilterFlat', () => {
  it('returns only entries whose task matches', () => {
    const tasks = [task({ id: 'a', status: 'todo' }), task({ id: 'b', status: 'done' })]
    const flat = flattenTasks(tasks)
    const out = applyTaskFilterFlat(flat, filter({ statuses: ['todo'] }), DEFAULT_STATUSES)
    expect(out.map((f) => f.task.id)).toEqual(['a'])
  })

  it('respects showArchived', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b', archived: true })]
    const flat = flattenTasks(tasks)
    expect(applyTaskFilterFlat(flat, filter(), DEFAULT_STATUSES).map((f) => f.task.id)).toEqual(['a'])
    expect(applyTaskFilterFlat(flat, filter({ showArchived: true }), DEFAULT_STATUSES).map((f) => f.task.id)).toEqual([
      'a',
      'b'
    ])
  })
})

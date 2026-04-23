import { describe, expect, it } from 'vitest'
import { addDays, computeSchedule, daysBetween, wouldCreateCycle } from './Scheduler'
import { DEFAULT_STATUSES, makeTask, type StatusConfig, type Task } from '../types'

function task(overrides: Partial<Task> & { id: string }): Task {
  return makeTask({
    start: '',
    due: '',
    ...overrides
  })
}

const statuses: StatusConfig[] = DEFAULT_STATUSES

describe('daysBetween', () => {
  it('returns 0 for the same date', () => {
    expect(daysBetween('2026-04-23', '2026-04-23')).toBe(0)
  })

  it('returns a positive count when b is after a', () => {
    expect(daysBetween('2026-04-23', '2026-04-30')).toBe(7)
  })

  it('returns a negative count when b is before a', () => {
    expect(daysBetween('2026-04-30', '2026-04-23')).toBe(-7)
  })

  it('crosses month boundaries', () => {
    expect(daysBetween('2026-01-30', '2026-02-02')).toBe(3)
  })
})

describe('addDays', () => {
  it('adds zero days', () => {
    expect(addDays('2026-04-23', 0)).toBe('2026-04-23')
  })

  it('adds positive days', () => {
    expect(addDays('2026-04-23', 7)).toBe('2026-04-30')
  })

  it('subtracts with negative days', () => {
    expect(addDays('2026-04-23', -3)).toBe('2026-04-20')
  })

  it('rolls over month boundaries', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02')
  })

  it('rolls over year boundaries', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
  })
})

describe('wouldCreateCycle', () => {
  it('returns false for disjoint tasks', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' })]
    expect(wouldCreateCycle(tasks, 'a', 'b')).toBe(false)
  })

  it('returns true when from can already reach to via dependents', () => {
    // b depends on a → there is a path a → b in scheduling direction.
    // Adding "a depends on b" (edge b → a) would close the cycle.
    const tasks = [task({ id: 'a' }), task({ id: 'b', dependencies: ['a'] })]
    expect(wouldCreateCycle(tasks, 'a', 'b')).toBe(true)
  })

  it('detects transitive cycles', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b', dependencies: ['a'] }), task({ id: 'c', dependencies: ['b'] })]
    expect(wouldCreateCycle(tasks, 'a', 'c')).toBe(true)
  })

  it('returns false for a valid chain extension', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b', dependencies: ['a'] }), task({ id: 'c' })]
    // Adding "c depends on b" does not cycle.
    expect(wouldCreateCycle(tasks, 'c', 'b')).toBe(false)
  })

  it('traverses into subtasks', () => {
    const child = task({ id: 'child', dependencies: ['root'] })
    const tasks = [task({ id: 'root', subtasks: [child] })]
    expect(wouldCreateCycle(tasks, 'root', 'child')).toBe(true)
  })
})

describe('computeSchedule', () => {
  it('returns no patches when there are no dependencies', () => {
    const tasks = [
      task({ id: 'a', start: '2026-04-01', due: '2026-04-05' }),
      task({ id: 'b', start: '2026-04-10', due: '2026-04-12' })
    ]
    const result = computeSchedule(tasks, undefined, statuses)
    expect(result.patches).toEqual([])
    expect(result.cycles).toEqual([])
  })

  it('shifts a successor that starts before its predecessor ends', () => {
    const tasks = [
      task({ id: 'a', start: '2026-04-01', due: '2026-04-10' }),
      task({ id: 'b', start: '2026-04-05', due: '2026-04-08', dependencies: ['a'] })
    ]
    const result = computeSchedule(tasks, undefined, statuses)
    const patch = result.patches.find((p) => p.taskId === 'b')
    // Earliest start = day after predecessor due (2026-04-11). Duration was 4 days.
    expect(patch).toEqual({ taskId: 'b', start: '2026-04-11', due: '2026-04-14' })
  })

  it('leaves a successor alone when it already starts after the predecessor', () => {
    const tasks = [
      task({ id: 'a', start: '2026-04-01', due: '2026-04-05' }),
      task({ id: 'b', start: '2026-04-10', due: '2026-04-12', dependencies: ['a'] })
    ]
    const result = computeSchedule(tasks, undefined, statuses)
    expect(result.patches).toEqual([])
  })

  it('cascades across a chain of dependencies', () => {
    const tasks = [
      task({ id: 'a', start: '2026-04-01', due: '2026-04-10' }),
      task({ id: 'b', start: '2026-04-02', due: '2026-04-04', dependencies: ['a'] }),
      task({ id: 'c', start: '2026-04-05', due: '2026-04-06', dependencies: ['b'] })
    ]
    const result = computeSchedule(tasks, undefined, statuses)
    const b = result.patches.find((p) => p.taskId === 'b')
    const c = result.patches.find((p) => p.taskId === 'c')
    expect(b).toEqual({ taskId: 'b', start: '2026-04-11', due: '2026-04-13' })
    // c must start after b's new due
    expect(c).toEqual({ taskId: 'c', start: '2026-04-14', due: '2026-04-15' })
  })

  it('shifts a milestone by its due date only', () => {
    const tasks = [
      task({ id: 'a', start: '2026-04-01', due: '2026-04-10' }),
      task({ id: 'm', type: 'milestone', start: '', due: '2026-04-05', dependencies: ['a'] })
    ]
    const result = computeSchedule(tasks, undefined, statuses)
    const patch = result.patches.find((p) => p.taskId === 'm')
    expect(patch).toEqual({ taskId: 'm', start: '', due: '2026-04-11' })
  })

  it('skips tasks in a terminal status', () => {
    const tasks = [
      task({ id: 'a', start: '2026-04-01', due: '2026-04-10' }),
      task({ id: 'b', start: '2026-04-02', due: '2026-04-03', status: 'done', dependencies: ['a'] })
    ]
    const result = computeSchedule(tasks, undefined, statuses)
    expect(result.patches).toEqual([])
  })

  it('ignores archived predecessors when computing earliest start', () => {
    const tasks = [
      task({ id: 'a', start: '2026-04-01', due: '2026-04-20', archived: true }),
      task({ id: 'b', start: '2026-04-01', due: '2026-04-05', dependencies: ['a'] })
    ]
    const result = computeSchedule(tasks, undefined, statuses)
    expect(result.patches).toEqual([])
  })

  it('detects cycles and reports them in cycles', () => {
    const tasks = [
      task({ id: 'a', start: '2026-04-01', due: '2026-04-02', dependencies: ['b'] }),
      task({ id: 'b', start: '2026-04-03', due: '2026-04-04', dependencies: ['a'] })
    ]
    const result = computeSchedule(tasks, undefined, statuses)
    expect(result.cycles).toHaveLength(1)
    expect(new Set(result.cycles[0])).toEqual(new Set(['a', 'b']))
  })

  it('scopes rescheduling to downstream dependents of changedTaskId', () => {
    const tasks = [
      task({ id: 'x', start: '2026-04-01', due: '2026-04-05' }),
      task({ id: 'y', start: '2026-04-01', due: '2026-04-02', dependencies: ['x'] }),
      task({ id: 'unrelated', start: '2026-04-01', due: '2026-04-02' })
    ]
    const result = computeSchedule(tasks, 'x', statuses)
    expect(result.patches.map((p) => p.taskId)).toEqual(['y'])
  })

  it('ignores missing dependency ids silently', () => {
    const tasks = [task({ id: 'a', start: '2026-04-01', due: '2026-04-05', dependencies: ['ghost'] })]
    const result = computeSchedule(tasks, undefined, statuses)
    expect(result.patches).toEqual([])
    expect(result.cycles).toEqual([])
  })
})

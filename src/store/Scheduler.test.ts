import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUSES, makeTask, type StatusConfig, type Task } from '../types'
import { addDays, computeSchedule, daysBetween, wouldCreateCycle } from './Scheduler'

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
    // b depends on a, so adding "a depends on b" closes the cycle.
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

describe('computeSchedule with pullForward', () => {
  const finishedEarly = task({
    id: 'a',
    start: '2026-07-06',
    due: '2026-07-13',
    completed: '2026-07-10',
    status: 'done'
  })

  it('leaves dependents alone when the option is off', () => {
    const tasks = [finishedEarly, task({ id: 'b', start: '2026-07-14', due: '2026-07-16', dependencies: ['a'] })]
    expect(computeSchedule(tasks, undefined, statuses).patches).toEqual([])
  })

  it('pulls a dependent back by the days its predecessor saved', () => {
    const tasks = [finishedEarly, task({ id: 'b', start: '2026-07-14', due: '2026-07-16', dependencies: ['a'] })]
    const result = computeSchedule(tasks, undefined, statuses, true)
    expect(result.patches).toEqual([{ taskId: 'b', start: '2026-07-11', due: '2026-07-13' }])
  })

  it('keeps the slack a dependent already had', () => {
    const tasks = [finishedEarly, task({ id: 'b', start: '2026-07-20', due: '2026-07-22', dependencies: ['a'] })]
    const result = computeSchedule(tasks, undefined, statuses, true)
    expect(result.patches).toEqual([{ taskId: 'b', start: '2026-07-17', due: '2026-07-19' }])
  })

  it('never pulls a dependent before the day after its predecessor finished', () => {
    const early = task({ id: 'a', start: '2026-07-01', due: '2026-07-13', completed: '2026-07-02', status: 'done' })
    const tasks = [early, task({ id: 'b', start: '2026-07-05', due: '2026-07-08', dependencies: ['a'] })]
    const result = computeSchedule(tasks, undefined, statuses, true)
    expect(result.patches).toEqual([{ taskId: 'b', start: '2026-07-03', due: '2026-07-06' }])
  })

  it('cascades the saved days down the chain', () => {
    const tasks = [
      finishedEarly,
      task({ id: 'b', start: '2026-07-14', due: '2026-07-16', dependencies: ['a'] }),
      task({ id: 'c', start: '2026-07-20', due: '2026-07-21', dependencies: ['b'] })
    ]
    const result = computeSchedule(tasks, undefined, statuses, true)
    expect(result.patches).toEqual([
      { taskId: 'b', start: '2026-07-11', due: '2026-07-13' },
      { taskId: 'c', start: '2026-07-17', due: '2026-07-18' }
    ])
  })

  it('holds a dependent in place while another predecessor is still due later', () => {
    const tasks = [
      finishedEarly,
      task({ id: 'gate', start: '2026-07-06', due: '2026-07-13' }),
      task({ id: 'b', start: '2026-07-14', due: '2026-07-16', dependencies: ['a', 'gate'] })
    ]
    expect(computeSchedule(tasks, undefined, statuses, true).patches).toEqual([])
  })

  it('pulls a milestone by its due date', () => {
    const tasks = [finishedEarly, task({ id: 'm', due: '2026-07-14', type: 'milestone', dependencies: ['a'] })]
    const result = computeSchedule(tasks, undefined, statuses, true)
    expect(result.patches).toEqual([{ taskId: 'm', start: '', due: '2026-07-11' }])
  })

  it('ignores a task that completed on or after its due date', () => {
    const onTime = task({ id: 'a', start: '2026-07-06', due: '2026-07-13', completed: '2026-07-13', status: 'done' })
    const tasks = [onTime, task({ id: 'b', start: '2026-07-20', due: '2026-07-22', dependencies: ['a'] })]
    expect(computeSchedule(tasks, undefined, statuses, true).patches).toEqual([])
  })

  it('ignores a completion date on a task that is not in a terminal status', () => {
    const reopened = task({ id: 'a', start: '2026-07-06', due: '2026-07-13', completed: '2026-07-10' })
    const tasks = [reopened, task({ id: 'b', start: '2026-07-14', due: '2026-07-16', dependencies: ['a'] })]
    expect(computeSchedule(tasks, undefined, statuses, true).patches).toEqual([])
  })

  it('still pushes a dependent that starts too early', () => {
    const tasks = [finishedEarly, task({ id: 'b', start: '2026-07-08', due: '2026-07-09', dependencies: ['a'] })]
    const result = computeSchedule(tasks, undefined, statuses, true)
    expect(result.patches).toEqual([{ taskId: 'b', start: '2026-07-11', due: '2026-07-12' }])
  })
})

describe('computeSchedule with predecessors in other projects', () => {
  const statuses: StatusConfig[] = [
    { id: 'todo', label: 'Todo', color: '#888', icon: '', complete: false },
    { id: 'done', label: 'Done', color: '#0a0', icon: '', complete: true }
  ]

  it('pushes a task out to clear a predecessor it does not share a project with', () => {
    const external = task({ id: 'ext', start: '2026-07-06', due: '2026-07-20' })
    const tasks = [task({ id: 'b', start: '2026-07-08', due: '2026-07-10', dependencies: ['ext'] })]
    const result = computeSchedule(tasks, undefined, statuses, false, [external])
    expect(result.patches).toEqual([{ taskId: 'b', start: '2026-07-21', due: '2026-07-23' }])
  })

  it('never moves the outside predecessor itself', () => {
    const external = task({ id: 'ext', start: '2026-07-20', due: '2026-07-22', dependencies: ['b'] })
    const tasks = [task({ id: 'b', start: '2026-07-06', due: '2026-07-08' })]
    const result = computeSchedule(tasks, undefined, statuses, false, [external])
    expect(result.patches.some((p) => p.taskId === 'ext')).toBe(false)
  })

  it('ignores a dependency that resolves nowhere at all', () => {
    const tasks = [task({ id: 'b', start: '2026-07-08', due: '2026-07-10', dependencies: ['gone'] })]
    expect(computeSchedule(tasks, undefined, statuses).patches).toEqual([])
  })
})

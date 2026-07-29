import { describe, expect, it } from 'vitest'
import { dueUrgency } from './utils'
import { makeTask, type StatusConfig } from './types'
import { today } from './dates'

const statuses: StatusConfig[] = [
  { id: 'todo', label: 'To do', color: '', icon: '', complete: false },
  { id: 'done', label: 'Done', color: '', icon: '', complete: true }
]

const inDays = (n: number): string => today().add({ days: n }).toString()

describe('dueUrgency', () => {
  it('flags an open task past its due date as overdue', () => {
    expect(dueUrgency(makeTask({ status: 'todo', due: inDays(-3) }), statuses)).toBe('overdue')
  })

  it('flags an open task due within three days as near', () => {
    expect(dueUrgency(makeTask({ status: 'todo', due: inDays(0) }), statuses)).toBe('near')
    expect(dueUrgency(makeTask({ status: 'todo', due: inDays(2) }), statuses)).toBe('near')
  })

  it('leaves an open task due further out plain', () => {
    expect(dueUrgency(makeTask({ status: 'todo', due: inDays(3) }), statuses)).toBe('normal')
    expect(dueUrgency(makeTask({ status: 'todo', due: inDays(30) }), statuses)).toBe('normal')
  })

  it('leaves a terminal task plain whatever its due date', () => {
    expect(dueUrgency(makeTask({ status: 'done', due: inDays(-30) }), statuses)).toBe('normal')
    expect(dueUrgency(makeTask({ status: 'done', due: inDays(-1) }), statuses)).toBe('normal')
    expect(dueUrgency(makeTask({ status: 'done', due: inDays(1) }), statuses)).toBe('normal')
  })

  it('leaves a task with no due date plain', () => {
    expect(dueUrgency(makeTask({ status: 'todo', due: '' }), statuses)).toBe('normal')
  })
})

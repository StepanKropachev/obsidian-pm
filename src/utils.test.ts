import { describe, expect, it } from 'vitest'
import { dueUrgency, priorityIcon } from './utils'
import { makeTask, DEFAULT_PRIORITIES, type PriorityConfig, type StatusConfig } from './types'
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

describe('priorityIcon', () => {
  const scale = (labels: string[]): PriorityConfig[] =>
    labels.map((label) => ({ id: label, label, color: '', icon: '' }))

  it('gives each of four priorities its own icon from the set', () => {
    const icons = DEFAULT_PRIORITIES.map((p) => priorityIcon(DEFAULT_PRIORITIES, p.id, 'signal'))
    expect(icons).toEqual(['signal', 'signal-high', 'signal-medium', 'signal-low'])
  })

  it('gives a fifth priority the last icon of the set', () => {
    const five = scale(['p0', 'p1', 'p2', 'p3', 'p4'])
    expect(five.map((p) => priorityIcon(five, p.id, 'chevrons'))).toEqual([
      'chevrons-up',
      'chevron-up',
      'equal',
      'chevron-down',
      'chevrons-down'
    ])
  })

  it('leaves ranks past the set without an icon', () => {
    const seven = scale(['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'])
    expect(seven.slice(5).map((p) => priorityIcon(seven, p.id, 'arrows'))).toEqual(['', ''])
  })

  it('takes icons from the top of the set on a shorter scale', () => {
    const two = scale(['urgent', 'whenever'])
    expect(two.map((p) => priorityIcon(two, p.id, 'chevrons'))).toEqual(['chevrons-up', 'chevron-up'])
  })

  it("prefers the priority's own icon over the set", () => {
    const custom: PriorityConfig[] = [{ id: 'high', label: 'High', color: '', icon: '🔥' }]
    expect(priorityIcon(custom, 'high', 'signal')).toBe('🔥')
  })

  it('gives no icon for the none set or an unknown priority', () => {
    expect(priorityIcon(DEFAULT_PRIORITIES, 'high', 'none')).toBe('')
    expect(priorityIcon(DEFAULT_PRIORITIES, 'nope', 'chevrons')).toBe('')
  })
})

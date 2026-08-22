import { describe, expect, it } from 'vitest'
import { dedupePeople, displayName, dueUrgency, priorityIcon } from './utils'
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

describe('displayName', () => {
  it('returns a plain name unchanged', () => {
    expect(displayName('Jane Doe')).toBe('Jane Doe')
  })

  it('trims a plain name', () => {
    expect(displayName('  Jane Doe  ')).toBe('Jane Doe')
  })

  it('unwraps a bare wikilink', () => {
    expect(displayName('[[Jane Doe]]')).toBe('Jane Doe')
  })

  it('strips the folder path from a bare wikilink', () => {
    expect(displayName('[[People/Team/Jane Doe]]')).toBe('Jane Doe')
  })

  it('prefers the alias when present', () => {
    expect(displayName('[[People/Jane Doe|JD]]')).toBe('JD')
  })

  it('trims the alias', () => {
    expect(displayName('[[People/Jane Doe| JD ]]')).toBe('JD')
  })

  it('falls back to the path when the alias is empty', () => {
    expect(displayName('[[People/Jane Doe|]]')).toBe('Jane Doe')
  })

  it('drops a file extension', () => {
    expect(displayName('[[People/Jane Doe.md]]')).toBe('Jane Doe')
  })

  it('drops a heading reference', () => {
    expect(displayName('[[People/Jane Doe#Bio]]')).toBe('Jane Doe')
  })

  it('drops a block reference', () => {
    expect(displayName('[[People/Jane Doe#^abc123]]')).toBe('Jane Doe')
  })

  it('keeps a dot inside a name', () => {
    expect(displayName('[[People/Jane.Doe]]')).toBe('Jane.Doe')
  })

  it('keeps a version-style name with a dot', () => {
    expect(displayName('[[v1.2 release]]')).toBe('v1.2 release')
  })

  it('leaves a non-wikilink string with brackets alone', () => {
    expect(displayName('[[unterminated')).toBe('[[unterminated')
  })
})

describe('dedupePeople', () => {
  it('keeps distinct people', () => {
    expect(dedupePeople(['Anna Reid', 'Zoe Ford'])).toEqual(['Anna Reid', 'Zoe Ford'])
  })

  it('collapses a wikilink and a plain name for the same person', () => {
    expect(dedupePeople(['[[John Doe]]', 'John Doe'])).toEqual(['[[John Doe]]'])
  })

  it('prefers the wikilink whichever order it arrives in', () => {
    expect(dedupePeople(['John Doe', '[[People/John Doe]]'])).toEqual(['[[People/John Doe]]'])
  })

  it('collapses two wikilinks that resolve to the same name', () => {
    expect(dedupePeople(['[[People/John Doe]]', '[[John Doe]]'])).toHaveLength(1)
  })

  it('sorts by display name, not by the raw string', () => {
    expect(dedupePeople(['Zoe Ford', '[[John Doe]]', 'Anna Reid'])).toEqual([
      'Anna Reid',
      '[[John Doe]]',
      'Zoe Ford'
    ])
  })

  it('drops empty values', () => {
    expect(dedupePeople(['', 'Anna Reid'])).toEqual(['Anna Reid'])
  })
})

describe('dedupePeople with a key function', () => {
  const keyOf = (raw: string): string => (raw.includes('Contacts') ? 'contacts-jane' : 'people-jane')

  it('keeps two people the key function separates', () => {
    expect(dedupePeople(['[[People/Jane]]', '[[Contacts/Jane]]'], keyOf)).toHaveLength(2)
  })

  it('collapses two spellings the key function calls the same', () => {
    expect(dedupePeople(['[[People/Jane]]', 'Jane'], keyOf)).toEqual(['[[People/Jane]]'])
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { completionOutcome, formatDate, formatDateLong, formatDateShort, relativeDue } from './dates'

const from = Temporal.PlainDate.from('2026-06-15')

describe('relativeDue', () => {
  it('returns null for empty or invalid dates', () => {
    expect(relativeDue('', from)).toBeNull()
    expect(relativeDue('not-a-date', from)).toBeNull()
  })

  it('flags overdue dates with the day count', () => {
    expect(relativeDue('2026-06-13', from)).toEqual({ text: '2d overdue', tone: 'overdue' })
    expect(relativeDue('2026-06-14', from)).toEqual({ text: '1d overdue', tone: 'overdue' })
  })

  it('labels today and tomorrow', () => {
    expect(relativeDue('2026-06-15', from)).toEqual({ text: 'Today', tone: 'today' })
    expect(relativeDue('2026-06-16', from)).toEqual({ text: 'Tomorrow', tone: 'today' })
  })

  it('labels dates within the week', () => {
    expect(relativeDue('2026-06-18', from)).toEqual({ text: 'In 3d', tone: 'soon' })
    expect(relativeDue('2026-06-21', from)).toEqual({ text: 'In 6d', tone: 'soon' })
  })

  it('returns null beyond a week out', () => {
    expect(relativeDue('2026-06-22', from)).toBeNull()
    expect(relativeDue('2026-12-01', from)).toBeNull()
  })
})

describe('completionOutcome', () => {
  it('returns null unless both dates are set', () => {
    expect(completionOutcome('', '2026-06-15')).toBeNull()
    expect(completionOutcome('2026-06-15', '')).toBeNull()
    expect(completionOutcome('not-a-date', '2026-06-15')).toBeNull()
  })

  it('counts the days a task ran past its due date', () => {
    expect(completionOutcome('2026-06-15', '2026-06-18')).toEqual({ text: '3d late', tone: 'outcome' })
    expect(completionOutcome('2026-06-15', '2026-06-16')).toEqual({ text: '1d late', tone: 'outcome' })
  })

  it('reads on time when the task landed on or before its due date', () => {
    expect(completionOutcome('2026-06-15', '2026-06-15')).toEqual({ text: 'On time', tone: 'outcome' })
    expect(completionOutcome('2026-06-15', '2026-06-01')).toEqual({ text: 'On time', tone: 'outcome' })
  })
})

describe('date formatting', () => {
  const ZONES = ['UTC', 'America/New_York', 'Pacific/Kiritimati']

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns an empty string for empty or invalid dates', () => {
    expect(formatDate('')).toBe('')
    expect(formatDateShort('not-a-date')).toBe('')
    expect(formatDateLong('')).toBe('')
  })

  // A YYYY-MM-DD field names a calendar day, not an instant: read as an instant it lands on
  // the day before wherever the clock is behind UTC.
  it.each(ZONES)('names the day the field says in %s', (zone) => {
    vi.stubEnv('TZ', zone)
    expect(formatDate('2026-03-28')).toContain('28')
    expect(formatDateShort('2026-03-28')).toContain('28')
    expect(formatDateLong('2026-03-28')).toContain('28')
  })
})

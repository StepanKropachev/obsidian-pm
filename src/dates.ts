import { Temporal } from 'temporal-polyfill'

export { Temporal }

/** Today as a PlainDate in the user's local timezone. */
export function today(): Temporal.PlainDate {
  return Temporal.Now.plainDateISO()
}

/** Parse a YYYY-MM-DD field; returns null for empty/invalid strings. */
export function parsePlainDate(s: string): Temporal.PlainDate | null {
  if (!s) return null
  try {
    return Temporal.PlainDate.from(s)
  } catch {
    return null
  }
}

/** Format a YYYY-MM-DD field as a short local date (e.g. "Jun 15, 2026"); '' when empty/invalid. */
export function formatDate(iso: string): string {
  const d = parsePlainDate(iso)
  return d ? d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'outcome'

/**
 * A short relative-due label for a YYYY-MM-DD date, or null when the date is
 * empty/invalid or far enough out (more than a week) that a hint adds nothing.
 * `from` is injectable so the result is deterministic in tests.
 */
export function relativeDue(iso: string, from: Temporal.PlainDate = today()): { text: string; tone: DueTone } | null {
  const due = parsePlainDate(iso)
  if (!due) return null
  const days = from.until(due, { largestUnit: 'day' }).days
  if (days < 0) return { text: `${-days}d overdue`, tone: 'overdue' }
  if (days === 0) return { text: 'Today', tone: 'today' }
  if (days === 1) return { text: 'Tomorrow', tone: 'today' }
  if (days <= 6) return { text: `In ${days}d`, tone: 'soon' }
  return null
}

/** Whether a finished task landed on its due date; null unless both dates are set. */
export function completionOutcome(due: string, completed: string): { text: string; tone: DueTone } | null {
  const dueDate = parsePlainDate(due)
  const completedDate = parsePlainDate(completed)
  if (!dueDate || !completedDate) return null
  const days = dueDate.until(completedDate, { largestUnit: 'day' }).days
  return { text: days > 0 ? `${days}d late` : 'On time', tone: 'outcome' }
}

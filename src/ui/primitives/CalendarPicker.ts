import { setIcon } from 'obsidian'
import { Temporal, parsePlainDate, today } from '../../dates'

/** Fixed Sun–Sat weekday header (pinned by the R16 contract; not localised). */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
] as const

// A calendar month never spans more than six Sunday-started weeks.
const WEEKS = 6
const DAYS_PER_WEEK = 7

/**
 * A month-grid date picker rendered entirely in plugin chrome — never an
 * OS/browser-native `<input type="date">`. A Sun–Sat weekday header, a month
 * label with previous/next navigation, and clickable day cells laid out in
 * Sunday-through-Saturday columns. Clicking a day emits its `YYYY-MM-DD` string.
 *
 * Chained-setter idiom (constructor takes `parentEl`, root exposed as `.el`).
 * All date math routes through `src/dates.ts` (`Temporal.PlainDate`), never
 * `Date` arithmetic, and no inline styles are assigned — styling lives in
 * `src/styles/calendar-picker.css`.
 */
export class CalendarPicker {
  el: HTMLElement
  private readonly titleEl: HTMLElement
  private readonly gridEl: HTMLElement
  private view: Temporal.PlainYearMonth
  private selected: Temporal.PlainDate | null = null
  private changeHandler: ((dateStr: string) => void) | null = null

  constructor(parentEl: HTMLElement) {
    this.el = parentEl.createDiv({ cls: 'pm-calendar-picker' })

    const header = this.el.createDiv({ cls: 'pm-calendar-picker__header' })
    const prev = header.createEl('button', {
      cls: 'pm-calendar-picker__nav pm-calendar-picker__prev',
      attr: { type: 'button', 'aria-label': 'Previous month' }
    })
    setIcon(prev, 'chevron-left')
    prev.addEventListener('click', () => this.shift(-1))

    this.titleEl = header.createDiv({ cls: 'pm-calendar-picker__title' })

    const next = header.createEl('button', {
      cls: 'pm-calendar-picker__nav pm-calendar-picker__next',
      attr: { type: 'button', 'aria-label': 'Next month' }
    })
    setIcon(next, 'chevron-right')
    next.addEventListener('click', () => this.shift(1))

    const weekdays = this.el.createDiv({ cls: 'pm-calendar-picker__weekdays' })
    for (const label of WEEKDAYS) weekdays.createDiv({ cls: 'pm-calendar-picker__weekday', text: label })

    this.gridEl = this.el.createDiv({ cls: 'pm-calendar-picker__grid' })

    const now = today()
    this.view = Temporal.PlainYearMonth.from({ year: now.year, month: now.month })
    this.render()
  }

  /** Set the selected/displayed date from a `YYYY-MM-DD` string. */
  setValue(dateStr: string): this {
    const parsed = parsePlainDate(dateStr)
    if (parsed) {
      this.selected = parsed
      this.view = Temporal.PlainYearMonth.from({ year: parsed.year, month: parsed.month })
    }
    this.render()
    return this
  }

  /** Register a handler fired with the picked day's `YYYY-MM-DD` string. */
  onChange(handler: (dateStr: string) => void): this {
    this.changeHandler = handler
    return this
  }

  private shift(months: number): void {
    this.view = this.view.add({ months })
    this.render()
  }

  private pick(date: Temporal.PlainDate): void {
    this.selected = date
    this.view = Temporal.PlainYearMonth.from({ year: date.year, month: date.month })
    this.render()
    this.changeHandler?.(date.toString())
  }

  private render(): void {
    this.titleEl.setText(`${MONTHS[this.view.month - 1]} ${this.view.year}`)
    this.gridEl.empty()

    const first = this.view.toPlainDate({ day: 1 })
    // Temporal weekday: Monday=1 … Sunday=7. `% 7` maps Sunday to a leading 0 so
    // the grid starts on Sunday.
    const start = first.subtract({ days: first.dayOfWeek % 7 })
    const now = today()

    for (let i = 0; i < WEEKS * DAYS_PER_WEEK; i++) {
      const date = start.add({ days: i })
      const inMonth = date.month === this.view.month && date.year === this.view.year
      const cls = ['pm-calendar-picker__day']
      if (!inMonth) cls.push('pm-calendar-picker__day--adjacent')
      if (this.selected && date.equals(this.selected)) cls.push('pm-calendar-picker__day--selected')
      if (date.equals(now)) cls.push('pm-calendar-picker__day--today')
      const cell = this.gridEl.createEl('button', {
        cls: cls.join(' '),
        text: String(date.day),
        attr: { type: 'button' }
      })
      cell.addEventListener('click', () => this.pick(date))
    }
  }
}

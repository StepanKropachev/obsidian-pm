// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest'
import { CalendarPicker } from './CalendarPicker'

const doc: Document = window.document

/**
 * Minimal polyfill of the Obsidian HTMLElement helpers the primitive relies on
 * (createEl/createDiv/setText/empty/setAttr). happy-dom supplies the base DOM.
 * Mirrors the harness in src/intention.test.ts. Idempotent.
 */
function patchObsidianDom(): void {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown> & { __pmPatched?: boolean }
  if (proto.__pmPatched) return
  proto.__pmPatched = true
  const applyOpts = (
    el: HTMLElement,
    o?: { cls?: string | string[]; text?: string; attr?: Record<string, string | number | boolean> }
  ): void => {
    if (!o) return
    if (o.cls) {
      const classes = Array.isArray(o.cls) ? o.cls : o.cls.split(/\s+/).filter(Boolean)
      el.classList.add(...classes)
    }
    if (o.text != null) el.textContent = o.text
    if (o.attr) for (const [k, v] of Object.entries(o.attr)) if (v != null) el.setAttribute(k, String(v))
  }
  function createEl(
    this: HTMLElement,
    tag: string,
    o?: { cls?: string | string[]; text?: string; attr?: Record<string, string | number | boolean> }
  ): HTMLElement {
    const child = doc.createElement(tag)
    applyOpts(child, o)
    this.appendChild(child)
    return child
  }
  proto.createEl = createEl
  proto.createDiv = function (this: HTMLElement, o?: { cls?: string | string[]; text?: string }): HTMLElement {
    return createEl.call(this, 'div', o)
  }
  proto.setText = function (this: HTMLElement, t: string): HTMLElement {
    this.textContent = t
    return this
  }
  proto.setAttr = function (this: HTMLElement, k: string, v: string | number | boolean | null): HTMLElement {
    if (v === null) this.removeAttribute(k)
    else this.setAttribute(k, String(v))
    return this
  }
  proto.empty = function (this: HTMLElement): HTMLElement {
    while (this.firstChild) this.removeChild(this.firstChild)
    return this
  }
}

beforeAll(() => patchObsidianDom())

function mount(): CalendarPicker {
  const root = doc.createElement('div')
  doc.body.appendChild(root)
  return new CalendarPicker(root)
}

function title(picker: CalendarPicker): string {
  return (picker.el.querySelector('.pm-calendar-picker__title')?.textContent ?? '').trim()
}

function inMonthDay(picker: CalendarPicker, day: string): HTMLElement | undefined {
  return Array.from(picker.el.querySelectorAll<HTMLElement>('.pm-calendar-picker__day')).find(
    (c) => (c.textContent ?? '').trim() === day && !/adjacent|other|outside|muted/.test(c.className)
  )
}

describe('CalendarPicker', () => {
  it('renders the month label for the set value', () => {
    const picker = mount()
    picker.setValue('2026-07-16')
    expect(title(picker)).toBe('July 2026')
  })

  it('advances to the next month and back', () => {
    const picker = mount()
    picker.setValue('2026-07-16')
    picker.el.querySelector<HTMLElement>('.pm-calendar-picker__next')?.click()
    expect(title(picker)).toBe('August 2026')
    picker.el.querySelector<HTMLElement>('.pm-calendar-picker__prev')?.click()
    expect(title(picker)).toBe('July 2026')
  })

  it('wraps January to the previous December when navigating back', () => {
    const picker = mount()
    picker.setValue('2026-01-10')
    picker.el.querySelector<HTMLElement>('.pm-calendar-picker__prev')?.click()
    expect(title(picker)).toBe('December 2025')
  })

  it('marks trailing days from the adjacent month', () => {
    const picker = mount()
    // Jul 1 2026 is a Wednesday, so Sun–Tue lead cells belong to June.
    picker.setValue('2026-07-16')
    const cells = Array.from(picker.el.querySelectorAll<HTMLElement>('.pm-calendar-picker__day'))
    expect(cells[0]?.className).toMatch(/adjacent/)
    // The first in-month cell (the 1st) must not be adjacent.
    expect(inMonthDay(picker, '1')).toBeTruthy()
  })

  it('renders Feb 29 in a leap year', () => {
    const picker = mount()
    picker.setValue('2024-02-15')
    expect(inMonthDay(picker, '29')).toBeTruthy()
  })

  it('emits the clicked day as a YYYY-MM-DD string', () => {
    const picker = mount()
    let received: string | undefined
    picker.onChange((d) => {
      received = d
    })
    picker.setValue('2026-07-16')
    inMonthDay(picker, '20')?.click()
    expect(received).toBe('2026-07-20')
  })
})

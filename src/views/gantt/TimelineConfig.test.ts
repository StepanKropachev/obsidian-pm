import { describe, it, expect } from 'vitest'
import { makeTask } from '../../types'
import { buildTimelineConfig, getSnapPoints, dateToX } from './TimelineConfig'
import { Temporal } from '../../dates'

const tasks = [makeTask({ start: '2026-03-10', due: '2026-04-20' })]

describe('buildTimelineConfig', () => {
  it('spans at least three years at year granularity', () => {
    const cfg = buildTimelineConfig(tasks, 'year')
    expect(cfg.totalDays).toBeGreaterThanOrEqual(1095)
  })

  it('starts a year timeline on the first of a month', () => {
    const cfg = buildTimelineConfig(tasks, 'year')
    expect(cfg.startDate.day).toBe(1)
  })

  it('gives a year column less width than a quarter column', () => {
    expect(buildTimelineConfig(tasks, 'year').dayWidth).toBeLessThan(buildTimelineConfig(tasks, 'quarter').dayWidth)
  })
})

describe('getSnapPoints', () => {
  it('snaps to month starts at year granularity', () => {
    const cfg = buildTimelineConfig(tasks, 'year')
    const points = getSnapPoints(cfg)
    const march = Temporal.PlainDate.from('2026-03-01')
    expect(points).toContain(dateToX(cfg, march))
    expect(points).not.toContain(dateToX(cfg, march.add({ days: 1 })))
  })
})

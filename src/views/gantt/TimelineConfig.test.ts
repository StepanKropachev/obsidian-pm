import { describe, expect, it, vi } from 'vitest'
import type { Task } from '../../types'

vi.mock('../../dates', async () => {
  const actual = await vi.importActual<typeof import('../../dates')>('../../dates')
  const fixedToday = actual.Temporal.PlainDate.from('2026-07-05')
  return {
    ...actual,
    today: () => fixedToday
  }
})

import { DAY_WIDTH, buildTimelineConfig, dateToX, getSnapPoints } from './TimelineConfig'

function makeTask(): Task {
  return {
    id: 'task-1',
    title: 'Year task',
    description: '',
    type: 'task',
    status: 'todo',
    priority: 'medium',
    start: '2026-03-10',
    due: '2026-05-22',
    progress: 0,
    completed: '',
    assignees: [],
    tags: [],
    subtasks: [],
    dependencies: [],
    customFields: {},
    collapsed: false,
    createdAt: '2026-03-10T00:00:00.000Z',
    updatedAt: '2026-03-10T00:00:00.000Z'
  }
}

describe('buildTimelineConfig year granularity', () => {
  it('uses only the current year range', () => {
    const cfg = buildTimelineConfig([makeTask()], 'year')

    expect(cfg.startDate.toString()).toBe('2026-01-01')
    expect(cfg.endDate.toString()).toBe('2027-01-01')
    expect(cfg.dayWidth).toBe(DAY_WIDTH.year)
    expect(cfg.totalDays).toBe(365)
    expect(cfg.totalWidth).toBe(365 * DAY_WIDTH.year)
    expect(dateToX(cfg, cfg.startDate)).toBe(0)
    expect(dateToX(cfg, cfg.startDate.add({ months: 1 }))).toBe(31 * DAY_WIDTH.year)
  })

  it('expands year view to match the available width', () => {
    const cfg = buildTimelineConfig([makeTask()], 'year', { availableWidth: 1708 })

    expect(cfg.dayWidth).toBe(5)
    expect(cfg.totalWidth).toBe(1825)
  })

  it('keeps month snap points in year view', () => {
    const cfg = buildTimelineConfig([makeTask()], 'year')
    const snapPoints = getSnapPoints(cfg)

    expect(snapPoints).toContain(dateToX(cfg, cfg.startDate.add({ months: 1 })))
    expect(snapPoints).toContain(dateToX(cfg, cfg.startDate.add({ months: 11 })))
  })
})

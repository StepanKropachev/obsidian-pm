import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type PMSettings } from '../types'
import { importTaskNotesPalettes, type TaskNotesApi } from './tasknotes'

function makeApi(): TaskNotesApi {
  return {
    apiVersion: 1,
    hasCapability: () => true,
    getTask: () => Promise.resolve(null),
    getSettingsSnapshot: () => ({}),
    getStatuses: () => [
      { id: 'open', value: 'open', label: 'Open', color: '#808080', isCompleted: false, order: 1 },
      { id: 'none', value: 'none', label: 'None', color: '#cccccc', isCompleted: false, order: 0 },
      { id: 'in-progress', value: 'in-progress', label: 'In progress', color: '#0066cc', isCompleted: false, order: 2 },
      { id: 'done', value: 'done', label: 'Finished', color: '#00aa00', isCompleted: true, order: 3 }
    ],
    getPriorities: () => [
      { id: 'low', value: 'low', label: 'Low', color: '#00aa00', weight: 1 },
      { id: 'urgent', value: 'urgent', label: 'Urgent', color: '#ff0000', weight: 9 },
      { id: 'high', value: 'high', label: 'Very high', color: '#ff8800', weight: 3 }
    ]
  }
}

function makeSettings(): PMSettings {
  return {
    ...DEFAULT_SETTINGS,
    statuses: DEFAULT_SETTINGS.statuses.map((s) => ({ ...s })),
    priorities: DEFAULT_SETTINGS.priorities.map((p) => ({ ...p }))
  }
}

describe('importTaskNotesPalettes', () => {
  it('adds unknown statuses and priorities in TaskNotes order', () => {
    const settings = makeSettings()
    const { added } = importTaskNotesPalettes(makeApi(), settings)

    const statusIds = settings.statuses.map((s) => s.id)
    expect(statusIds).toContain('none')
    expect(statusIds).toContain('open')
    expect(statusIds.indexOf('none')).toBeLessThan(statusIds.indexOf('open'))

    const priorityIds = settings.priorities.map((p) => p.id)
    expect(priorityIds).toContain('urgent')
    // Higher TaskNotes weight lands earlier (most important first).
    expect(priorityIds.indexOf('urgent')).toBeLessThan(priorityIds.indexOf('low'))
    expect(added).toBe(3)
  })

  it('updates label, color, and completion of entries with a matching id', () => {
    const settings = makeSettings()
    const { updated } = importTaskNotesPalettes(makeApi(), settings)

    const done = settings.statuses.find((s) => s.id === 'done')
    expect(done?.label).toBe('Finished')
    expect(done?.complete).toBe(true)
    const high = settings.priorities.find((p) => p.id === 'high')
    expect(high?.label).toBe('Very high')
    expect(high?.color).toBe('#ff8800')
    expect(updated).toBeGreaterThanOrEqual(2)
  })

  it('keeps entries TaskNotes does not know and is idempotent', () => {
    const settings = makeSettings()
    importTaskNotesPalettes(makeApi(), settings)
    expect(settings.statuses.map((s) => s.id)).toContain('blocked')
    expect(settings.priorities.map((p) => p.id)).toContain('critical')

    const second = importTaskNotesPalettes(makeApi(), settings)
    expect(second).toEqual({ added: 0, updated: 0 })
  })
})

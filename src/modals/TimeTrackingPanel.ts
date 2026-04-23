import type { Task } from '../types'
import { totalLoggedHours } from '../store/TaskTreeOps'
import { today } from '../dates'

/**
 * Renders the time tracking section (estimate, progress bar, log entries)
 * into the given container.
 */
export function renderTimeTrackingPanel(container: HTMLElement, task: Task): void {
  if (task.type === 'milestone') return

  const timeSection = container.createDiv('pm-modal-section')
  const timeHeader = timeSection.createDiv('pm-modal-section-header')
  const logged = totalLoggedHours(task)
  const est = task.timeEstimate ?? 0
  const timeLabel = est > 0 ? `Time tracking (${logged}h / ${est}h)` : `Time tracking (${logged}h logged)`
  timeHeader.createEl('h4', { text: timeLabel, cls: 'pm-modal-section-title' })

  // Estimate
  const estRow = timeSection.createDiv('pm-time-est-row')
  estRow.createEl('span', { text: 'Estimate:', cls: 'pm-time-label' })
  const estInput = estRow.createEl('input', { type: 'number', cls: 'pm-prop-text pm-time-est-input' })
  estInput.value = est > 0 ? String(est) : ''
  estInput.placeholder = 'Hours'
  estInput.min = '0'
  estInput.step = '0.5'
  estInput.addEventListener('change', () => {
    const v = parseFloat(estInput.value)
    task.timeEstimate = isNaN(v) || v <= 0 ? undefined : v
  })

  // Progress bar
  if (est > 0) {
    const pct = Math.min(100, Math.round((logged / est) * 100))
    const timeBar = timeSection.createDiv('pm-time-bar')
    const timeFill = timeBar.createDiv('pm-time-bar-fill')
    timeFill.setCssStyles({ width: `${pct}%`, background: pct > 100 ? 'var(--pm-danger)' : 'var(--pm-accent)' })
  }

  // Log entries
  const logList = timeSection.createDiv('pm-time-log-list')
  const renderLogs = () => {
    logList.empty()
    if (!task.timeLogs) task.timeLogs = []
    for (let i = 0; i < task.timeLogs.length; i++) {
      const log = task.timeLogs[i]
      const row = logList.createDiv('pm-time-log-row')

      const dateInput = row.createEl('input', { type: 'date', cls: 'pm-prop-date pm-time-log-date' })
      dateInput.value = log.date
      dateInput.addEventListener('change', () => {
        log.date = dateInput.value
      })

      const hoursInput = row.createEl('input', { type: 'number', cls: 'pm-prop-text pm-time-log-hours' })
      hoursInput.value = String(log.hours)
      hoursInput.min = '0'
      hoursInput.step = '0.25'
      hoursInput.placeholder = 'Hours'
      hoursInput.addEventListener('change', () => {
        log.hours = parseFloat(hoursInput.value) || 0
      })

      const noteInput = row.createEl('input', { type: 'text', cls: 'pm-prop-text pm-time-log-note' })
      noteInput.value = log.note
      noteInput.placeholder = 'Note\u2026'
      noteInput.addEventListener('change', () => {
        log.note = noteInput.value
      })

      const rmBtn = row.createEl('button', { text: '\u2715', cls: 'pm-subtask-rm' })
      rmBtn.addClass('pm-subtask-rm--visible')
      rmBtn.addEventListener('click', () => {
        task.timeLogs!.splice(i, 1)
        renderLogs()
      })
    }
  }
  renderLogs()

  const addLogBtn = timeSection.createEl('button', { text: '+ log time', cls: 'pm-prop-add-btn' })
  addLogBtn.addEventListener('click', () => {
    if (!task.timeLogs) task.timeLogs = []
    task.timeLogs.push({
      date: today().toString(),
      hours: 0,
      note: ''
    })
    renderLogs()
  })
}

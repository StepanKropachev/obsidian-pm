import { setIcon } from 'obsidian'
import type PMPlugin from '../main'
import type { Task } from '../types'
import { makeTask } from '../types'
import { getStatusConfig, isTerminalStatus, getCompleteStatusId, getDefaultStatusId } from '../utils'
import { ProgressBar } from '../ui/primitives/ProgressBar'

/**
 * Renders the subtasks section: a header with derived progress, the editable list, and an
 * inline add row. Progress is derived from how many subtasks sit in a terminal status.
 */
export function renderSubtasksPanel(container: HTMLElement, task: Task, plugin: PMPlugin): void {
  const statuses = plugin.settings.statuses
  const subSection = container.createDiv('pm-modal-section')

  const subHeader = subSection.createDiv('pm-modal-section-header')
  subHeader.createEl('h4', { text: 'Subtasks', cls: 'pm-modal-section-title' })
  const progressWrap = subHeader.createDiv('pm-subtasks-progress')

  const subList = subSection.createDiv('pm-modal-subtask-list')

  const renderProgress = () => {
    progressWrap.empty()
    const total = task.subtasks.length
    if (total === 0) return
    const done = task.subtasks.filter((s) => isTerminalStatus(s.status, statuses)).length
    progressWrap.createSpan({ cls: 'pm-subtasks-count', text: `${done}/${total}` })
    new ProgressBar(progressWrap).setValue(Math.round((done / total) * 100)).setSize('sm')
  }

  const renderSubtasks = () => {
    subList.empty()
    for (const sub of task.subtasks) {
      const row = subList.createDiv('pm-modal-subtask-row')
      const subStatus = getStatusConfig(statuses, sub.status)

      const check = row.createEl('input', { type: 'checkbox', cls: 'pm-subtask-checkbox' })
      check.checked = isTerminalStatus(sub.status, statuses)
      check.addEventListener('change', () => {
        sub.status = check.checked ? getCompleteStatusId(statuses) : getDefaultStatusId(statuses)
        sub.progress = check.checked ? 100 : 0
        renderSubtasks()
        renderProgress()
      })

      const dot = row.createSpan({ cls: 'pm-subtask-dot' })
      dot.setCssProps({ '--pm-glyph-color': subStatus?.color ?? 'var(--text-muted)' })

      const titleEl = row.createSpan({ text: sub.title, cls: 'pm-subtask-title' })
      titleEl.contentEditable = 'true'
      titleEl.addEventListener('blur', () => {
        sub.title = titleEl.textContent?.trim() ?? sub.title
      })

      const rm = row.createEl('button', { cls: 'pm-subtask-rm' })
      setIcon(rm, 'x')
      rm.addEventListener('click', () => {
        task.subtasks = task.subtasks.filter((s) => s.id !== sub.id)
        renderSubtasks()
        renderProgress()
      })
    }
  }

  renderSubtasks()
  renderProgress()

  const addRow = subSection.createDiv('pm-subtask-add-row')
  const addInput = addRow.createEl('input', {
    cls: 'pm-subtask-add-input',
    attr: { placeholder: 'Add subtask…' }
  })
  addInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    const title = addInput.value.trim()
    if (!title) return
    task.subtasks.push(makeTask({ title, type: 'subtask' }))
    addInput.value = ''
    renderSubtasks()
    renderProgress()
  })
}

import { setIcon } from 'obsidian'
import type PMPlugin from '../main'
import type { Task } from '../types'
import { makeTask } from '../types'
import { isTerminalStatus, getCompleteStatusId, getDefaultStatusId } from '../utils'
import { Checkbox } from '../ui/primitives/Checkbox'

/**
 * Renders the subtasks section: a header with a completed count, the editable list, and an
 * inline add row. The count is derived from how many subtasks sit in a terminal status.
 */
export function renderSubtasksPanel(container: HTMLElement, task: Task, plugin: PMPlugin): void {
  const statuses = plugin.settings.statuses
  const subSection = container.createDiv('pm-modal-section')

  const subHeader = subSection.createDiv('pm-subtasks-header')
  const heading = subHeader.createEl('h4', { text: 'Subtasks ', cls: 'pm-modal-section-title' })
  const countEl = heading.createSpan({ cls: 'pm-subtasks-count' })

  const subList = subSection.createDiv('pm-modal-subtask-list')

  const renderCount = () => {
    const total = task.subtasks.length
    if (total === 0) {
      countEl.setText('')
      return
    }
    const done = task.subtasks.filter((s) => isTerminalStatus(s.status, statuses)).length
    countEl.setText(`${done}/${total}`)
  }

  const renderSubtasks = () => {
    subList.empty()
    for (const sub of task.subtasks) {
      const row = subList.createDiv('pm-modal-subtask-row')

      new Checkbox(row).setChecked(isTerminalStatus(sub.status, statuses)).onChange((checked) => {
        sub.status = checked ? getCompleteStatusId(statuses) : getDefaultStatusId(statuses)
        sub.progress = checked ? 100 : 0
        renderSubtasks()
        renderCount()
      })

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
        renderCount()
      })
    }
  }

  renderSubtasks()
  renderCount()

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
    renderCount()
  })
}

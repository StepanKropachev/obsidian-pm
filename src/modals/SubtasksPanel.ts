import type PMPlugin from '../main'
import type { Task } from '../types'
import { makeTask } from '../types'
import { COLOR_MUTED } from '../constants'
import { getStatusConfig, isTerminalStatus, getCompleteStatusId, getDefaultStatusId } from '../utils'

/**
 * Renders the subtasks section (list + add button) into the given container.
 */
export function renderSubtasksPanel(container: HTMLElement, task: Task, plugin: PMPlugin): void {
  const subSection = container.createDiv('pm-modal-section')
  const subHeader = subSection.createDiv('pm-modal-section-header')
  subHeader.createEl('h4', { text: `Subtasks (${task.subtasks.length})`, cls: 'pm-modal-section-title' })
  const addSubBtn = subHeader.createEl('button', { text: '+ add', cls: 'pm-btn pm-btn-ghost pm-btn-sm' })

  const subList = subSection.createDiv('pm-modal-subtask-list')
  const renderSubtasks = () => {
    subList.empty()
    for (const sub of task.subtasks) {
      const row = subList.createDiv('pm-modal-subtask-row')
      const subStatus = getStatusConfig(plugin.settings.statuses, sub.status)

      const statuses = plugin.settings.statuses
      const check = row.createEl('input', { type: 'checkbox', cls: 'pm-subtask-checkbox' })
      check.checked = isTerminalStatus(sub.status, statuses)
      check.addEventListener('change', () => {
        sub.status = check.checked ? getCompleteStatusId(statuses) : getDefaultStatusId(statuses)
        sub.progress = check.checked ? 100 : 0
        renderSubtasks()
      })

      const dot = row.createEl('span', { cls: 'pm-subtask-dot' })
      dot.setCssStyles({ background: subStatus?.color ?? COLOR_MUTED })

      const titleEl = row.createEl('span', { text: sub.title, cls: 'pm-subtask-title' })
      titleEl.contentEditable = 'true'
      titleEl.addEventListener('blur', () => {
        sub.title = titleEl.textContent?.trim() ?? sub.title
      })

      const rm = row.createEl('button', { text: '\u2715', cls: 'pm-subtask-rm' })
      rm.addEventListener('click', () => {
        task.subtasks = task.subtasks.filter((s) => s.id !== sub.id)
        renderSubtasks()
      })
    }
  }
  renderSubtasks()

  addSubBtn.addEventListener('click', () => {
    const newSub = makeTask({ title: 'New subtask' })
    task.subtasks.push(newSub)
    renderSubtasks()
    activeWindow.setTimeout(() => {
      const rows = subList.querySelectorAll('.pm-subtask-title')
      const last = rows[rows.length - 1] as HTMLElement
      if (last) {
        last.focus()
        const range = activeDocument.createRange()
        range.selectNodeContents(last)
        const sel = activeWindow.getSelection()
        if (sel) {
          sel.removeAllRanges()
          sel.addRange(range)
        }
      }
    }, 50)
  })
}

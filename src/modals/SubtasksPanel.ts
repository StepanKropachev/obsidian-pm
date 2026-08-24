import type { StatusConfig, Task } from '../types'
import { makeTask } from '../types'
import { renderNoteLink } from '../ui/composites/noteLink'
import { Checkbox } from '../ui/primitives/Checkbox'
import { IconButton } from '../ui/primitives/IconButton'
import { isTerminalStatus, getCompleteStatusId, getDefaultStatusId } from '../utils'

/** The header count is how many subtasks sit in a terminal status. */
export function renderSubtasksPanel(
  container: HTMLElement,
  task: Task,
  statuses: StatusConfig[],
  openSubtask: (filePath: string) => void
): void {
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

      const done = isTerminalStatus(sub.status, statuses)

      new Checkbox(row)
        .setChecked(done)
        .setAriaLabel(`Done: ${sub.title}`)
        .onChange((checked) => {
          sub.status = checked ? getCompleteStatusId(statuses) : getDefaultStatusId(statuses)
          sub.progress = checked ? 100 : 0
          renderSubtasks()
          renderCount()
        })

      // A subtask typed into the add field below has no note yet, so there is nothing to
      // open until the editor saves.
      const cls = done ? 'pm-subtask-title pm-subtask-title--done' : 'pm-subtask-title'
      const filePath = sub.filePath
      if (filePath) {
        renderNoteLink(row, { label: sub.title, path: filePath, open: () => openSubtask(filePath), cls })
      } else {
        row.createSpan({ text: sub.title, cls })
      }

      new IconButton(row)
        .setIcon('x')
        .setTooltip('Remove subtask')
        .setRevealOnHover(true)
        .onClick(() => {
          task.subtasks = task.subtasks.filter((s) => s.id !== sub.id)
          renderSubtasks()
          renderCount()
        })
    }
  }

  renderSubtasks()
  renderCount()

  const addRow = subSection.createDiv('pm-modal-subtask-row pm-subtask-add-row')
  addRow.createSpan({ cls: 'pm-subtask-checkbox-ghost', attr: { 'aria-hidden': 'true' } })
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

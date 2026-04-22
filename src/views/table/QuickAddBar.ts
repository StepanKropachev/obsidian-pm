import { Notice } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project } from '../../types'
import { makeTask } from '../../types'
import { addTaskToTree, deleteTaskFromTree } from '../../store/TaskTreeOps'
import { safeAsync } from '../../utils'

export function renderQuickAddBar(
  container: HTMLElement,
  project: Project,
  plugin: PMPlugin,
  onRefresh: () => Promise<void>
): void {
  const bar = container.createDiv('pm-quick-add')
  const input = bar.createEl('input', {
    type: 'text',
    placeholder: 'Quick add task… (press Enter)',
    cls: 'pm-quick-add-input'
  })
  input.addEventListener(
    'keydown',
    safeAsync(async (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        const title = input.value.trim()
        if (!title) return
        const task = makeTask({ title })
        addTaskToTree(project.tasks, task, null)
        try {
          await plugin.store.saveProject(project)
        } catch (err) {
          deleteTaskFromTree(project.tasks, task.id)
          new Notice('Failed to save task. Please try again.')
          console.error('QuickAddBar: save failed', err)
          await onRefresh()
          return
        }
        input.value = ''
        await onRefresh()
      } else if (e.key === 'Escape') {
        input.value = ''
        input.blur()
      }
    })
  )
}

export function focusQuickAdd(container: HTMLElement): void {
  const input = container.querySelector('.pm-quick-add-input')
  if (input) {
    ;(input as HTMLInputElement).focus()
    ;(input as HTMLInputElement).select()
  }
}

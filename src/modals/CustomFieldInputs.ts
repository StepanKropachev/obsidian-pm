import type PMPlugin from '../main'
import type { Project, Task, CustomFieldDef } from '../types'
import { collectAllAssignees } from '../store/TaskTreeOps'
import { renderPersonPicker } from '../ui/PersonPicker'
import { ChipButton } from '../ui/primitives/ChipButton'
import {
  renderDateControl,
  renderInputControl,
  renderMultiSelect,
  renderSelectControl
} from '../ui/composites/properties'
import { stringifyCustomValue } from '../utils'

export function renderCustomFieldInput(
  cf: CustomFieldDef,
  task: Task,
  project: Project,
  plugin: PMPlugin,
  rerender: () => void
): HTMLElement {
  const value = task.customFields[cf.id]
  const wrap = createDiv('pm-prop-value')
  const commit = (next: unknown): void => {
    task.customFields[cf.id] = next
    rerender()
  }

  switch (cf.type) {
    case 'text':
    case 'url': {
      renderInputControl({ container: wrap, value: stringifyCustomValue(value), onChange: commit })
      break
    }
    case 'number': {
      renderInputControl({
        container: wrap,
        value: stringifyCustomValue(value),
        inputType: 'number',
        onChange: (raw) => {
          const parsed = parseFloat(raw)
          commit(Number.isNaN(parsed) ? '' : parsed)
        }
      })
      break
    }
    case 'date': {
      renderDateControl({ container: wrap, value: stringifyCustomValue(value), onChange: commit })
      break
    }
    case 'checkbox': {
      const checked = Boolean(value)
      new ChipButton(wrap)
        .setLabel(checked ? 'Yes' : 'No')
        .setActive(checked)
        .onClick(() => commit(!checked))
      break
    }
    case 'select': {
      renderSelectControl({
        container: wrap,
        value: stringifyCustomValue(value) || null,
        options: [{ id: '', label: 'None' }, ...(cf.options ?? []).map((option) => ({ id: option, label: option }))],
        onChange: commit
      })
      break
    }
    case 'multiselect': {
      const picked = (): string[] => {
        const current = task.customFields[cf.id]
        return Array.isArray(current) ? (current as string[]) : []
      }
      renderMultiSelect({
        container: wrap,
        addLabel: 'Add value',
        addLabelMore: 'Add another',
        selected: picked,
        options: () => (cf.options ?? []).map((option) => ({ id: option, label: option })),
        add: (option) => {
          task.customFields[cf.id] = [...picked(), option]
        },
        remove: (option) => {
          task.customFields[cf.id] = picked().filter((v) => v !== option)
        }
      })
      break
    }
    case 'person': {
      renderPersonPicker({
        container: wrap,
        plugin,
        sourcePath: task.filePath ?? project.filePath,
        extra: () => [...project.teamMembers, ...collectAllAssignees(project.tasks)],
        addLabel: 'Set person',
        selected: () => {
          const current = task.customFields[cf.id]
          return typeof current === 'string' && current ? [current] : []
        },
        add: (person) => {
          task.customFields[cf.id] = person
        },
        remove: () => {
          task.customFields[cf.id] = ''
        }
      })
      break
    }
  }
  return wrap
}

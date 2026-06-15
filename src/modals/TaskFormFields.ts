import type PMPlugin from '../main'
import { Project, Task, TaskType, TaskPriority, Recurrence } from '../types'
import { flattenTasks } from '../store/TaskTreeOps'
import { wouldCreateCycle } from '../store/Scheduler'
import { renderPropRow } from '../ui/FormField'
import { isTerminalStatus } from '../utils'
import { renderCustomFieldInput } from './CustomFieldInputs'
import {
  renderSelectControl,
  renderDateControl,
  renderMultiSelect,
  renderAddProperty,
  type SelectItem,
  type HiddenProperty
} from '../ui/composites/properties'

export interface TaskFormFieldsContext {
  task: Task
  project: Project
  plugin: PMPlugin
  parentId: string | null
  setParentId: (id: string | null) => void
  rerender: () => void
  shownExtras: Set<string>
}

const TYPE_OPTIONS: SelectItem[] = [
  { id: 'task', label: 'Task', icon: 'square-check-big' },
  { id: 'subtask', label: 'Subtask', icon: 'git-branch' },
  { id: 'milestone', label: 'Milestone', icon: 'diamond' }
]

const REPEAT_OPTIONS: SelectItem[] = [
  { id: 'none', label: 'Does not repeat', icon: 'repeat' },
  { id: 'daily', label: 'Daily', icon: 'repeat' },
  { id: 'weekly', label: 'Weekly', icon: 'repeat' },
  { id: 'monthly', label: 'Monthly', icon: 'repeat' },
  { id: 'yearly', label: 'Yearly', icon: 'repeat' }
]

/**
 * Renders the compact property grid: core properties (status, priority, type, assignees, due,
 * tags) always show; rarely-used ones (start, repeat, depends on) hide when empty behind
 * "Add property". Single-selects and dates re-render the form on change; multi-selects mutate
 * the task in place and refresh their own chips.
 */
export function renderTaskFormFields(container: HTMLElement, ctx: TaskFormFieldsContext): void {
  const { task, project, plugin, rerender, shownExtras } = ctx
  const statuses = plugin.settings.statuses
  const priorities = plugin.settings.priorities
  const grid = container.createDiv('pm-prop-grid')

  // Status
  renderPropRow(
    grid,
    'Status',
    () => {
      const cell = createDiv('pm-prop-value')
      renderSelectControl({
        container: cell,
        value: task.status,
        options: statuses.map((s) => ({ id: s.id, label: s.label, color: s.color })),
        menuLabel: 'Set status',
        onChange: (id) => {
          task.status = id
          rerender()
        }
      })
      return cell
    },
    'circle-dot'
  )

  // Priority
  renderPropRow(
    grid,
    'Priority',
    () => {
      const cell = createDiv('pm-prop-value')
      renderSelectControl({
        container: cell,
        value: task.priority,
        options: priorities.map((p) => ({ id: p.id, label: p.label, color: p.color })),
        menuLabel: 'Set priority',
        onChange: (id) => {
          task.priority = id as TaskPriority
          rerender()
        }
      })
      return cell
    },
    'flag'
  )

  // Type
  renderPropRow(
    grid,
    'Type',
    () => {
      const cell = createDiv('pm-prop-value')
      renderSelectControl({
        container: cell,
        value: task.type,
        options: TYPE_OPTIONS,
        menuLabel: 'Task type',
        onChange: (id) => {
          task.type = id as TaskType
          if (id === 'milestone') {
            task.start = ''
            task.progress = 0
          }
          if (id !== 'subtask') ctx.setParentId(null)
          rerender()
        }
      })
      return cell
    },
    'shapes'
  )

  // Parent task (subtask only)
  if (task.type === 'subtask') {
    renderPropRow(
      grid,
      'Parent task',
      () => {
        const cell = createDiv('pm-prop-value')
        const allTasks = flattenTasks(project.tasks)
          .map((f) => f.task)
          .filter((t) => t.id !== task.id)
        const sel = cell.createEl('select', { cls: 'pm-prop-select' })
        sel.createEl('option', { value: '', text: ctx.parentId ? '' : '— Select parent —' })
        for (const t of allTasks) {
          const opt = sel.createEl('option', { value: t.id, text: t.title })
          if (t.id === ctx.parentId) opt.selected = true
        }
        sel.addEventListener('change', () => ctx.setParentId(sel.value || null))
        return cell
      },
      'corner-up-right'
    )
  }

  // Assignees
  renderPropRow(
    grid,
    'Assignees',
    () => {
      const cell = createDiv('pm-prop-value')
      const allMembers = () => [...new Set([...project.teamMembers, ...plugin.settings.globalTeamMembers])]
      renderMultiSelect({
        container: cell,
        avatar: true,
        search: true,
        addLabel: 'Assign',
        placeholder: 'Search people…',
        selected: () => task.assignees,
        options: () => allMembers().map((m) => ({ id: m, label: m })),
        add: (id) => {
          if (!task.assignees.includes(id)) task.assignees.push(id)
        },
        remove: (id) => {
          task.assignees = task.assignees.filter((a) => a !== id)
        },
        create: (label) => {
          if (!task.assignees.includes(label)) task.assignees.push(label)
        }
      })
      return cell
    },
    'users'
  )

  // Due (Date for milestones)
  renderPropRow(
    grid,
    task.type === 'milestone' ? 'Date' : 'Due',
    () => {
      const cell = createDiv('pm-prop-value')
      renderDateControl({
        container: cell,
        value: task.due,
        emptyLabel: 'Set due date',
        onChange: (v) => {
          task.due = v
          rerender()
        }
      })
      return cell
    },
    'calendar-clock'
  )

  // Start (extra; hidden for milestones)
  if (task.type !== 'milestone' && (task.start || shownExtras.has('start'))) {
    renderPropRow(
      grid,
      'Start',
      () => {
        const cell = createDiv('pm-prop-value')
        renderDateControl({
          container: cell,
          value: task.start,
          emptyLabel: 'Set start',
          onChange: (v) => {
            task.start = v
            rerender()
          }
        })
        return cell
      },
      'play'
    )
  }

  // Completed (when complete or in a terminal status)
  if (task.completed || isTerminalStatus(task.status, statuses)) {
    renderPropRow(
      grid,
      'Completed',
      () => {
        const cell = createDiv('pm-prop-value')
        renderDateControl({
          container: cell,
          value: task.completed,
          emptyLabel: 'Set date',
          onChange: (v) => {
            task.completed = v
            rerender()
          }
        })
        return cell
      },
      'circle-check-big'
    )
  }

  // Tags
  const tagsRow = renderPropRow(
    grid,
    'Tags',
    () => {
      const cell = createDiv('pm-prop-value')
      const projectTags = [...new Set(flattenTasks(project.tasks).flatMap((f) => f.task.tags))]
      renderMultiSelect({
        container: cell,
        search: true,
        addLabel: 'Add tags',
        placeholder: 'Find or create…',
        tag: true,
        selected: () => task.tags,
        options: () => projectTags.map((t) => ({ id: t, label: t })),
        add: (id) => {
          if (!task.tags.includes(id)) task.tags.push(id)
        },
        remove: (id) => {
          task.tags = task.tags.filter((t) => t !== id)
        },
        create: (label) => {
          if (!task.tags.includes(label)) task.tags.push(label)
        }
      })
      return cell
    },
    'tag'
  )
  tagsRow.addClass('pm-prop-row--wide')

  // Repeat (extra)
  if (task.recurrence || shownExtras.has('repeat')) {
    renderPropRow(
      grid,
      'Repeat',
      () => {
        const cell = createDiv('pm-prop-value')
        renderSelectControl({
          container: cell,
          value: task.recurrence?.interval ?? 'none',
          options: REPEAT_OPTIONS,
          menuLabel: 'Recurrence',
          onChange: (id) => {
            if (id === 'none') {
              task.recurrence = undefined
            } else {
              task.recurrence = {
                interval: id as Recurrence['interval'],
                every: task.recurrence?.every ?? 1,
                endDate: task.recurrence?.endDate
              }
            }
            rerender()
          }
        })
        return cell
      },
      'repeat'
    )
  }

  // Depends on (extra)
  if (task.dependencies.length > 0 || shownExtras.has('depends')) {
    const allTasks = flattenTasks(project.tasks)
      .map((f) => f.task)
      .filter((t) => t.id !== task.id)
    const titleOf = (id: string) => allTasks.find((t) => t.id === id)?.title ?? id
    const depRow = renderPropRow(
      grid,
      'Depends on',
      () => {
        const cell = createDiv('pm-prop-value')
        renderMultiSelect({
          container: cell,
          search: true,
          addLabel: 'Add dependency',
          placeholder: 'Search tasks…',
          chipShape: 'rounded',
          labelFor: titleOf,
          selected: () => task.dependencies.filter((id) => allTasks.some((t) => t.id === id)),
          options: () =>
            allTasks
              .filter((t) => task.dependencies.includes(t.id) || !wouldCreateCycle(project.tasks, task.id, t.id))
              .map((t) => ({ id: t.id, label: t.title })),
          add: (id) => {
            if (!task.dependencies.includes(id)) task.dependencies.push(id)
          },
          remove: (id) => {
            task.dependencies = task.dependencies.filter((d) => d !== id)
          }
        })
        return cell
      },
      'link-2'
    )
    depRow.addClass('pm-prop-row--wide')
  }

  // Progressive disclosure for the remaining empty extras
  const hidden: HiddenProperty[] = []
  if (task.type !== 'milestone' && !task.start && !shownExtras.has('start')) {
    hidden.push({ id: 'start', label: 'Start', icon: 'play' })
  }
  if (!task.recurrence && !shownExtras.has('repeat')) {
    hidden.push({ id: 'repeat', label: 'Repeat', icon: 'repeat' })
  }
  if (task.dependencies.length === 0 && !shownExtras.has('depends')) {
    hidden.push({ id: 'depends', label: 'Depends on', icon: 'link-2' })
  }
  if (hidden.length > 0) {
    const addCell = grid.createDiv('pm-prop-add-cell')
    renderAddProperty(addCell, hidden, (id) => {
      shownExtras.add(id)
      rerender()
    })
  }

  // Custom fields
  if (project.customFields.length > 0) {
    const cfSection = container.createDiv('pm-modal-section')
    cfSection.createEl('h4', { text: 'Custom fields', cls: 'pm-modal-section-title' })
    const cfGrid = cfSection.createDiv('pm-prop-grid')
    for (const cf of project.customFields) {
      renderPropRow(cfGrid, cf.name, () => renderCustomFieldInput(cf, task, project, plugin))
    }
  }
}

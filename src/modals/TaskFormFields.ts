import type PMPlugin from '../main'
import type { Project, Task, TaskType, Recurrence } from '../types'
import { flattenTasks } from '../store/TaskTreeOps'
import { wouldCreateCycle } from '../store/Scheduler'
import { renderPropRow } from '../ui/FormField'
import { Chip } from '../ui/primitives/Chip'
import { PRIORITY_CHEVRONS } from '../ui/StatusBadge'
import { isTerminalStatus, stringToColor } from '../utils'
import { completionOutcome, relativeDue } from '../dates'
import { renderCustomFieldInput } from './CustomFieldInputs'
import {
  renderSelectControl,
  renderDateControl,
  renderInputControl,
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
 * The property grid. Core properties always show; the rest hide when empty behind "Add
 * property". Single-selects and dates re-render the form on change; multi-selects mutate
 * the task in place and refresh their own chips.
 */
export function renderTaskFormFields(container: HTMLElement, ctx: TaskFormFieldsContext): void {
  const { task, project, plugin, rerender, shownExtras } = ctx
  const { statuses, priorities } = plugin.store.configFor(project)
  const grid = container.createDiv('pm-prop-grid')

  renderPropRow(
    grid,
    'Type',
    () => {
      const cell = createDiv('pm-prop-value')
      renderSelectControl({
        container: cell,
        value: task.type,
        options: TYPE_OPTIONS,
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

  // The parent picker shares the type row and shows only for subtasks; an empty cell holds
  // the column otherwise, so switching type never reflows the grid.
  if (task.type === 'subtask') {
    renderPropRow(
      grid,
      'Parent task',
      () => {
        const cell = createDiv('pm-prop-value')
        const parents = flattenTasks(project.tasks)
          .map((f) => f.task)
          .filter((t) => t.id !== task.id)
        renderSelectControl({
          container: cell,
          value: ctx.parentId,
          options: [{ id: '', label: 'No parent' }, ...parents.map((t) => ({ id: t.id, label: t.title }))],
          placeholder: 'Select parent',
          search: true,
          searchPlaceholder: 'Search tasks…',
          width: 230,
          onChange: (id) => {
            ctx.setParentId(id || null)
            rerender()
          }
        })
        return cell
      },
      'corner-up-right'
    )
  } else {
    grid.createDiv()
  }

  renderPropRow(
    grid,
    'Status',
    () => {
      const cell = createDiv('pm-prop-value')
      renderSelectControl({
        container: cell,
        value: task.status,
        options: statuses.map((s) => ({ id: s.id, label: s.label, color: s.color, icon: s.icon || undefined })),
        onChange: (id) => {
          task.status = id
          rerender()
        }
      })
      return cell
    },
    'circle-dot'
  )

  renderPropRow(
    grid,
    'Priority',
    () => {
      const cell = createDiv('pm-prop-value')
      renderSelectControl({
        container: cell,
        value: task.priority,
        options: priorities.map((p) => ({
          id: p.id,
          label: p.label,
          color: p.color,
          icon: p.icon || PRIORITY_CHEVRONS[p.id]
        })),
        onChange: (id) => {
          task.priority = id
          rerender()
        }
      })
      return cell
    },
    'flag'
  )

  renderPropRow(
    grid,
    task.type === 'milestone' ? 'Date' : 'Due',
    () => {
      const cell = createDiv('pm-prop-value')
      renderDateControl({
        container: cell,
        value: task.due,
        emptyLabel: 'Set due date',
        hint: isTerminalStatus(task.status, statuses) ? null : relativeDue(task.due),
        onChange: (v) => {
          task.due = v
          rerender()
        }
      })
      return cell
    },
    'calendar-clock'
  )

  // Start shares the dates row with Due. Milestones have no start, so an empty cell holds
  // the slot and Assignees still leads the next row.
  if (task.type !== 'milestone') {
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
  } else {
    grid.createDiv()
  }

  renderPropRow(
    grid,
    'Assignees',
    () => {
      const cell = createDiv('pm-prop-value')
      const allMembers = () => [...new Set([...project.teamMembers, ...plugin.settings.globalTeamMembers])]
      renderMultiSelect({
        container: cell,
        avatarStack: true,
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
          hint: completionOutcome(task.due, task.completed),
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

  if (task.type !== 'milestone' && (task.progress > 0 || shownExtras.has('progress'))) {
    renderPropRow(
      grid,
      'Progress',
      () => {
        const cell = createDiv('pm-prop-value')
        renderInputControl({
          container: cell,
          value: String(task.progress),
          inputType: 'number',
          suffix: '%',
          number: { min: 0, max: 100 },
          onChange: (v) => {
            task.progress = Number(v)
            rerender()
          }
        })
        return cell
      },
      'percent'
    )
  }

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
        colorFor: plugin.settings.showTagColors ? (t) => stringToColor(t) : undefined,
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

  if (task.dependencies.length > 0 || shownExtras.has('depends')) {
    const ownTasks = flattenTasks(project.tasks)
      .map((f) => f.task)
      .filter((t) => t.id !== task.id)
    const ownIds = new Set(ownTasks.map((t) => t.id))
    // Tasks in other projects can be depended on too, so the picker offers the whole
    // vault, this project first and everything else labelled with its project.
    const foreign = plugin.index
      .allTaskRefs()
      .filter((ref) => ref.id !== task.id && !ownIds.has(ref.id))
      .map((ref) => ({
        id: ref.id,
        label: ref.projectPath
          ? `${ref.title}  ·  ${plugin.index.projectRef(ref.projectPath)?.title ?? ''}`.trimEnd()
          : ref.title
      }))
    const allTasks: { id: string; label: string }[] = [
      ...ownTasks.map((t) => ({ id: t.id, label: t.title })),
      ...foreign
    ]
    const titleOf = (id: string) => allTasks.find((t) => t.id === id)?.label ?? id
    const depRow = renderPropRow(
      grid,
      'Depends on',
      () => {
        const cell = createDiv('pm-prop-value')
        renderMultiSelect({
          container: cell,
          search: true,
          addLabel: 'Add dependency',
          addLabelMore: 'Add another',
          placeholder: 'Search tasks…',
          depsList: true,
          labelFor: titleOf,
          selected: () => task.dependencies.filter((id) => allTasks.some((t) => t.id === id)),
          options: () =>
            allTasks.filter(
              (t) =>
                task.dependencies.includes(t.id) ||
                !(ownIds.has(t.id)
                  ? wouldCreateCycle(project.tasks, task.id, t.id)
                  : plugin.index.wouldCreateCycle(task.id, t.id))
            ),
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

  // The other side of a dependency, which is otherwise only visible from the task that
  // declared it, and invisible altogether when that task is in another project.
  const blocks = plugin.index.dependents(task.id)
  if (blocks.length) {
    const blocksRow = renderPropRow(
      grid,
      'Blocks',
      () => {
        const cell = createDiv('pm-prop-value')
        for (const ref of blocks) {
          const owner = ref.projectPath ? plugin.index.projectRef(ref.projectPath) : null
          new Chip(cell)
            .setLabel(ref.title)
            .setVariant('outline')
            .setSize('sm')
            .setTooltip(owner ? `In ${owner.title}` : 'Task')
        }
        return cell
      },
      'link-2'
    )
    blocksRow.addClass('pm-prop-row--wide')
  }

  const hidden: HiddenProperty[] = []
  if (task.type !== 'milestone' && task.progress === 0 && !shownExtras.has('progress')) {
    hidden.push({ id: 'progress', label: 'Progress', icon: 'percent' })
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

  if (project.customFields.length > 0) {
    const cfSection = container.createDiv('pm-modal-section')
    cfSection.createEl('h4', { text: 'Custom fields', cls: 'pm-modal-section-title' })
    const cfGrid = cfSection.createDiv('pm-prop-grid')
    for (const cf of project.customFields) {
      renderPropRow(cfGrid, cf.name, () => renderCustomFieldInput(cf, task, project, plugin))
    }
  }
}

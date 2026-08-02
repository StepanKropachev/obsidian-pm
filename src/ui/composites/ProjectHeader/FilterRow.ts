import { Menu } from 'obsidian'
import type { CustomFieldDef, Project, FilterState, StatusConfig, PriorityConfig, DueDateFilter } from '../../../types'
import { collectAllAssignees, collectAllTags } from '../../../store'
import { countActiveFilters } from '../../../store/TaskFilter'
import { renderFilterDropdown } from '../../FilterDropdown'
import { ChipButton } from '../../primitives/ChipButton'
import { formatBadgeText, stringifyCustomValue } from '../../../utils'

export interface FilterRowProps {
  project: Project
  statuses: StatusConfig[]
  priorities: PriorityConfig[]
  filter: FilterState
  onFilterChange: () => void
  onClear: () => void
}

const DUE_LABELS: Record<DueDateFilter, string> = {
  any: 'Due date',
  overdue: 'Overdue',
  'this-week': 'This week',
  'this-month': 'This month',
  'no-date': 'No date'
}

export class FilterRow {
  el: HTMLElement
  private clearBtn: ChipButton | null = null

  constructor(
    parentEl: HTMLElement,
    private props: FilterRowProps
  ) {
    this.el = parentEl.createDiv('pm-project-header-filter')
    this.render()
  }

  private render(): void {
    this.el.empty()
    const { filter, statuses, priorities, project } = this.props

    const notify = () => {
      this.props.onFilterChange()
      this.updateClearButton()
    }

    renderFilterDropdown(
      this.el,
      'Status',
      filter.statuses,
      statuses.map((s) => ({ id: s.id, label: formatBadgeText(s.icon, s.label) })),
      (selected) => {
        filter.statuses = selected
        notify()
      }
    )

    renderFilterDropdown(
      this.el,
      'Priority',
      filter.priorities,
      priorities.map((p) => ({ id: p.id, label: formatBadgeText(p.icon, p.label) })),
      (selected) => {
        filter.priorities = selected
        notify()
      }
    )

    const allAssignees = collectAllAssignees(project.tasks)
    if (allAssignees.length) {
      renderFilterDropdown(
        this.el,
        'Assignee',
        filter.assignees,
        allAssignees.map((a) => ({ id: a, label: a })),
        (selected) => {
          filter.assignees = selected
          notify()
        }
      )
    }

    const allTags = collectAllTags(project.tasks)
    if (allTags.length) {
      renderFilterDropdown(
        this.el,
        'Tag',
        filter.tags,
        allTags.map((t) => ({ id: t, label: t })),
        (selected) => {
          filter.tags = selected
          notify()
        }
      )
    }

    for (const cf of project.customFields.filter((field) => field.filterable)) {
      this.renderCustomFieldFilter(cf, notify)
    }

    this.renderDueDateButton(notify)
    this.renderArchivedButton(notify)
    this.renderClearButton()
  }

  private renderCustomFieldFilter(cf: CustomFieldDef, notify: () => void): void {
    const { filter, project } = this.props
    const btn = new ChipButton(this.el).setAriaLabel(`Filter by ${cf.name}`)
    const updateLabel = () => {
      const current = filter.customFields[cf.id]
      const active = this.isCustomFieldSelectionActive(current)
      const label = active ? `${cf.name}: ${this.describeCustomFieldSelection(cf, current)}` : cf.name
      btn.setLabel(label).setActive(active)
    }
    updateLabel()

    btn.onClick((e) => {
      const menu = new Menu()
      const current = filter.customFields[cf.id]

      if (cf.type === 'checkbox') {
        for (const opt of [true, false]) {
          const label = opt ? 'Yes' : 'No'
          menu.addItem((item) =>
            item
              .setTitle(label)
              .setChecked(current?.type === 'checkbox' && current.value === opt)
              .onClick(() => {
                filter.customFields[cf.id] = { type: cf.type, value: opt }
                updateLabel()
                notify()
              })
          )
        }
      } else if (cf.type === 'multiselect') {
        const selected = Array.isArray(current?.value) ? current.value : []
        const options = this.getCustomFieldOptions(cf, project)
        for (const opt of options) {
          menu.addItem((item) =>
            item
              .setTitle(opt)
              .setChecked(selected.includes(opt))
              .onClick(() => {
                const next = selected.includes(opt) ? selected.filter((v) => v !== opt) : [...selected, opt]
                filter.customFields[cf.id] = { type: cf.type, value: next }
                updateLabel()
                notify()
              })
          )
        }
      } else {
        const selected = current?.type === cf.type ? String(current.value) : ''
        const options = this.getCustomFieldOptions(cf, project)
        for (const opt of options) {
          menu.addItem((item) =>
            item
              .setTitle(opt)
              .setChecked(selected === opt)
              .onClick(() => {
                filter.customFields[cf.id] = { type: cf.type, value: opt }
                updateLabel()
                notify()
              })
          )
        }
      }

      if (this.isCustomFieldSelectionActive(current)) {
        menu.addSeparator()
        menu.addItem((item) =>
          item.setTitle('Clear').onClick(() => {
            delete filter.customFields[cf.id]
            updateLabel()
            notify()
          })
        )
      }
      menu.showAtMouseEvent(e)
    })
  }

  private isCustomFieldSelectionActive(selection: { type: CustomFieldDef['type']; value: string | string[] | number | boolean | null } | undefined): boolean {
    if (!selection) return false
    if (selection.type === 'multiselect') {
      return Array.isArray(selection.value) && selection.value.length > 0
    }
    return selection.value !== undefined && selection.value !== null && selection.value !== ''
  }

  private describeCustomFieldSelection(cf: CustomFieldDef, selection: { type: CustomFieldDef['type']; value: string | string[] | number | boolean | null } | undefined): string {
    if (!selection) return cf.name
    if (cf.type === 'multiselect' && Array.isArray(selection.value)) {
      return selection.value.join(', ')
    }
    if (cf.type === 'checkbox') {
      return selection.value ? 'Yes' : 'No'
    }
    return stringifyCustomValue(selection.value)
  }

  private getCustomFieldOptions(cf: CustomFieldDef, project: Project): string[] {
    const values: string[] = []
    const seen = new Set<string>()
    const add = (value: unknown) => {
      const text = stringifyCustomValue(value)
      if (text && !seen.has(text)) {
        values.push(text)
        seen.add(text)
      }
    }

    if (cf.type === 'select' || cf.type === 'multiselect') {
      for (const opt of cf.options ?? []) {
        add(opt)
      }
    }

    if (cf.type === 'multiselect') {
      for (const task of project.tasks) {
        const current = task.customFields[cf.id]
        if (Array.isArray(current)) {
          for (const value of current) {
            add(value)
          }
        }
      }
      return values
    }

    for (const task of project.tasks) {
      add(task.customFields[cf.id])
    }

    return values
  }

  private renderDueDateButton(notify: () => void): void {
    const { filter } = this.props
    const btn = new ChipButton(this.el)
    const updateLabel = () => {
      const current = filter.dueDateFilter
      btn.setLabel(current !== 'any' ? `Due: ${DUE_LABELS[current]}` : DUE_LABELS.any).setActive(current !== 'any')
    }
    updateLabel()
    btn.onClick((e) => {
      const menu = new Menu()
      const opts: DueDateFilter[] = ['any', 'overdue', 'this-week', 'this-month', 'no-date']
      for (const opt of opts) {
        menu.addItem((item) =>
          item
            .setTitle(DUE_LABELS[opt])
            .setChecked(filter.dueDateFilter === opt)
            .onClick(() => {
              filter.dueDateFilter = opt
              updateLabel()
              notify()
            })
        )
      }
      menu.showAtMouseEvent(e)
    })
  }

  private renderArchivedButton(notify: () => void): void {
    const { filter } = this.props
    const btn = new ChipButton(this.el).setLabel('Archived').setActive(filter.showArchived)
    btn.onClick(() => {
      filter.showArchived = !filter.showArchived
      btn.setActive(filter.showArchived)
      notify()
    })
  }

  private renderClearButton(): void {
    const count = countActiveFilters(this.props.filter)
    if (count === 0) {
      this.clearBtn = null
      return
    }
    this.clearBtn = new ChipButton(this.el).setLabel(`Clear (${count})`).onClick(() => {
      this.props.onClear()
    })
  }

  refreshClearButton(): void {
    this.updateClearButton()
  }

  private updateClearButton(): void {
    if (this.clearBtn) {
      this.clearBtn.el.remove()
      this.clearBtn = null
    }
    this.renderClearButton()
  }
}

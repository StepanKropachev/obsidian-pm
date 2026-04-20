import { Menu } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project, FilterState, TaskPriority, DueDateFilter } from '../../types'
import { makeDefaultFilter } from '../../types'
import { collectAllAssignees, collectAllTags } from '../../store'
import { renderFilterDropdown } from '../../ui/FilterDropdown'
import { formatBadgeText } from '../../utils'

export interface FilterBarContext {
  project: Project
  plugin: PMPlugin
  filter: FilterState
  setFilter: (f: FilterState) => void
  activeSavedViewId: string | null
  setActiveSavedViewId: (id: string | null) => void
  refreshTable: () => void
  rerender: () => void
}

export function renderFilterBar(container: HTMLElement, ctx: FilterBarContext): void {
  const bar = container.createDiv('pm-filter-bar')

  // Text search
  const search = bar.createEl('input', {
    type: 'text',
    placeholder: 'Search tasks…',
    cls: 'pm-filter-input'
  })
  search.value = ctx.filter.text
  search.addEventListener('input', () => {
    ctx.filter.text = search.value
    ctx.refreshTable()
  })

  // Status filter
  renderFilterDropdown(
    bar,
    'Status',
    ctx.filter.statuses,
    ctx.plugin.settings.statuses.map((s) => ({ id: s.id, label: formatBadgeText(s.icon, s.label) })),
    (selected) => {
      ctx.filter.statuses = selected
      ctx.rerender()
    }
  )

  // Priority filter
  renderFilterDropdown(
    bar,
    'Priority',
    ctx.filter.priorities,
    ctx.plugin.settings.priorities.map((p) => ({ id: p.id, label: formatBadgeText(p.icon, p.label) })),
    (selected) => {
      ctx.filter.priorities = selected as TaskPriority[]
      ctx.rerender()
    }
  )

  // Assignee filter
  const allAssignees = collectAllAssignees(ctx.project.tasks)
  if (allAssignees.length) {
    renderFilterDropdown(
      bar,
      'Assignee',
      ctx.filter.assignees,
      allAssignees.map((a) => ({ id: a, label: a })),
      (selected) => {
        ctx.filter.assignees = selected
        ctx.rerender()
      }
    )
  }

  // Tag filter
  const allTags = collectAllTags(ctx.project.tasks)
  if (allTags.length) {
    renderFilterDropdown(
      bar,
      'Tag',
      ctx.filter.tags,
      allTags.map((t) => ({ id: t, label: t })),
      (selected) => {
        ctx.filter.tags = selected
        ctx.rerender()
      }
    )
  }

  // Due date filter
  renderDueDateFilter(bar, ctx)

  // Show archived toggle
  const archiveBtn = bar.createEl('button', {
    text: ctx.filter.showArchived ? 'Archived ✓' : 'Archived',
    cls: 'pm-filter-dropdown-btn'
  })
  if (ctx.filter.showArchived) archiveBtn.addClass('pm-filter-dropdown-btn--active')
  archiveBtn.addEventListener('click', () => {
    ctx.filter.showArchived = !ctx.filter.showArchived
    archiveBtn.setText(ctx.filter.showArchived ? 'Archived ✓' : 'Archived')
    archiveBtn.toggleClass('pm-filter-dropdown-btn--active', ctx.filter.showArchived)
    ctx.refreshTable()
  })

  // Clear button
  const activeCount = countActiveFilters(ctx.filter)
  if (activeCount > 0) {
    const clearBtn = bar.createEl('button', { text: `✕ Clear (${activeCount})`, cls: 'pm-btn pm-btn-ghost pm-btn-sm' })
    clearBtn.addEventListener('click', () => {
      ctx.setFilter(makeDefaultFilter())
      ctx.setActiveSavedViewId(null)
      ctx.rerender()
    })
  }
}

function renderDueDateFilter(parent: HTMLElement, ctx: FilterBarContext): void {
  const current = ctx.filter.dueDateFilter
  const labels: Record<DueDateFilter, string> = {
    any: 'Due date',
    overdue: 'Overdue',
    'this-week': 'This week',
    'this-month': 'This month',
    'no-date': 'No date'
  }
  const btn = parent.createEl('button', {
    text: current !== 'any' ? `Due: ${labels[current]}` : 'Due date',
    cls: 'pm-filter-dropdown-btn'
  })
  if (current !== 'any') btn.addClass('pm-filter-dropdown-btn--active')

  btn.addEventListener('click', (e) => {
    const menu = new Menu()
    const opts: DueDateFilter[] = ['any', 'overdue', 'this-week', 'this-month', 'no-date']
    for (const opt of opts) {
      menu.addItem((item) =>
        item
          .setTitle(labels[opt])
          .setChecked(current === opt)
          .onClick(() => {
            ctx.filter.dueDateFilter = opt
            ctx.rerender()
          })
      )
    }
    menu.showAtMouseEvent(e)
  })
}

function countActiveFilters(f: FilterState): number {
  let count = 0
  if (f.text) count++
  if (f.statuses.length) count++
  if (f.priorities.length) count++
  if (f.assignees.length) count++
  if (f.tags.length) count++
  if (f.dueDateFilter !== 'any') count++
  if (f.showArchived) count++
  return count
}

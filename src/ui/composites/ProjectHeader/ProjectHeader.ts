import type { Task, FilterState, SavedView, StatusConfig, PriorityConfig } from '../../../types'
import { isFilterActive } from '../../../store/TaskFilter'
import { PrimaryRow } from './PrimaryRow'
import { FilterRow } from './FilterRow'

export interface ProjectHeaderProps {
  /** Every task in scope, for the assignee and tag options. */
  tasks: Task[]
  savedViews: SavedView[]
  statuses: StatusConfig[]
  priorities: PriorityConfig[]
  filter: FilterState
  activeSavedViewId: string | null
  /** Decides who counts as the same person in the assignee filter. */
  personKeyOf: (raw: string) => string
  onFilterChange: () => void
  onClearFilter: () => void
  onSavedViewSelect: (id: string | null) => void
  onSavedViewSave: (name: string) => Promise<void>
  onSavedViewUpdate: (id: string) => Promise<void>
  onSavedViewDelete: (id: string) => Promise<void>
}

export class ProjectHeader {
  el: HTMLElement
  private filterRowExpanded = false
  private primaryRow: PrimaryRow | null = null
  private filterRow: FilterRow | null = null

  constructor(
    parentEl: HTMLElement,
    private props: ProjectHeaderProps
  ) {
    this.el = parentEl.createDiv('pm-project-header')
    this.render()
  }

  /** Re-render after the filter or activeSavedViewId is replaced wholesale. */
  refresh(): void {
    this.render()
  }

  /** In-place sync after the header itself mutated the filter. */
  notifyMutation(): void {
    this.primaryRow?.refreshVolatile()
    this.syncFilterRowVisibility()
    this.filterRow?.refreshClearButton()
  }

  setActiveSavedViewId(id: string | null): void {
    this.props.activeSavedViewId = id
    this.primaryRow?.setActiveSavedViewId(id)
  }

  private render(): void {
    this.el.empty()
    this.primaryRow = new PrimaryRow(this.el, {
      savedViews: this.props.savedViews,
      filter: this.props.filter,
      activeSavedViewId: this.props.activeSavedViewId,
      filterRowExpanded: this.filterRowExpanded,
      onSearchChange: this.props.onFilterChange,
      onSavedViewSelect: this.props.onSavedViewSelect,
      onSavedViewSave: this.props.onSavedViewSave,
      onSavedViewUpdate: this.props.onSavedViewUpdate,
      onSavedViewDelete: this.props.onSavedViewDelete,
      onToggleFilterRow: () => {
        this.filterRowExpanded = !this.filterRowExpanded
        this.syncFilterRowVisibility()
        this.primaryRow?.refreshVolatile()
      }
    })

    if (this.shouldShowFilterRow()) {
      this.mountFilterRow()
    }
  }

  private syncFilterRowVisibility(): void {
    const shouldShow = this.shouldShowFilterRow()
    if (shouldShow && !this.filterRow) {
      this.mountFilterRow()
    } else if (!shouldShow && this.filterRow) {
      this.filterRow.el.remove()
      this.filterRow = null
    }
  }

  private mountFilterRow(): void {
    this.filterRow = new FilterRow(this.el, {
      tasks: this.props.tasks,
      statuses: this.props.statuses,
      priorities: this.props.priorities,
      filter: this.props.filter,
      personKeyOf: this.props.personKeyOf,
      onFilterChange: this.props.onFilterChange,
      onClear: this.props.onClearFilter
    })
  }

  private shouldShowFilterRow(): boolean {
    return this.filterRowExpanded || isFilterActive(this.props.filter) || this.props.filter.showArchived
  }
}

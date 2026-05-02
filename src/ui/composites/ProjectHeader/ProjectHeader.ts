import type { Project, FilterState, StatusConfig, PriorityConfig } from '../../../types'
import { isFilterActive } from '../../../store/TaskFilter'
import { PrimaryRow } from './PrimaryRow'
import { FilterRow } from './FilterRow'

export interface ProjectHeaderProps {
  project: Project
  statuses: StatusConfig[]
  priorities: PriorityConfig[]
  filter: FilterState
  activeSavedViewId: string | null
  onFilterChange: () => void
  onClearFilter: () => void
  onQuickAdd: (title: string) => Promise<void>
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

  focusQuickAdd(): void {
    this.primaryRow?.focusQuickAdd()
  }

  /** Re-render after a filter or activeSavedViewId replacement (e.g., apply saved view, clear). */
  refresh(): void {
    this.render()
  }

  /** In-place sync after the user mutated filter via the header (no full re-render). */
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
      project: this.props.project,
      filter: this.props.filter,
      activeSavedViewId: this.props.activeSavedViewId,
      filterRowExpanded: this.filterRowExpanded,
      onQuickAdd: this.props.onQuickAdd,
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
      project: this.props.project,
      statuses: this.props.statuses,
      priorities: this.props.priorities,
      filter: this.props.filter,
      onFilterChange: this.props.onFilterChange,
      onClear: this.props.onClearFilter
    })
  }

  private shouldShowFilterRow(): boolean {
    return this.filterRowExpanded || isFilterActive(this.props.filter) || this.props.filter.showArchived
  }
}

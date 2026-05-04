import { ButtonComponent, Menu } from 'obsidian'
import type { Project, FilterState, SavedView } from '../../../types'
import { Pill } from '../../primitives/Pill'
import { isFilterActive } from '../../../store/TaskFilter'
import { safeAsync } from '../../../utils'

export interface PrimaryRowProps {
  project: Project
  filter: FilterState
  activeSavedViewId: string | null
  filterRowExpanded: boolean
  onSearchChange: () => void
  onSavedViewSelect: (id: string | null) => void
  onSavedViewSave: (name: string) => Promise<void>
  onSavedViewUpdate: (id: string) => Promise<void>
  onSavedViewDelete: (id: string) => Promise<void>
  onToggleFilterRow: () => void
}

export class PrimaryRow {
  el: HTMLElement
  private volatileEl: HTMLElement | null = null

  constructor(
    parentEl: HTMLElement,
    private props: PrimaryRowProps
  ) {
    this.el = parentEl.createDiv('pm-project-header-primary')
    this.renderSearchInput()
    this.volatileEl = this.el.createDiv('pm-project-header-actions')
    this.renderVolatile()
  }

  setActiveSavedViewId(id: string | null): void {
    this.props.activeSavedViewId = id
    this.renderVolatile()
  }

  refreshVolatile(): void {
    this.renderVolatile()
  }

  private renderVolatile(): void {
    if (!this.volatileEl) return
    this.volatileEl.empty()
    this.renderSavedViewPills(this.volatileEl)
    this.renderSaveViewAction(this.volatileEl)
    this.renderFilterToggle(this.volatileEl)
  }

  private renderSearchInput(): void {
    const input = this.el.createEl('input', {
      type: 'text',
      placeholder: 'Search tasks…',
      cls: 'pm-project-header-search'
    })
    input.value = this.props.filter.text
    input.addEventListener('input', () => {
      this.props.filter.text = input.value
      this.props.onSearchChange()
    })
  }

  private renderSavedViewPills(parent: HTMLElement): void {
    const wrap = parent.createDiv('pm-project-header-saved-views')

    new Pill(wrap)
      .setLabel('All')
      .setShape('pill')
      .setActive(!this.props.activeSavedViewId)
      .onClick(() => {
        this.props.onSavedViewSelect(null)
      })

    for (const sv of this.props.project.savedViews) {
      this.renderSavedViewPill(wrap, sv)
    }
  }

  private renderSavedViewPill(parent: HTMLElement, sv: SavedView): void {
    new Pill(parent)
      .setLabel(sv.name)
      .setShape('pill')
      .setActive(this.props.activeSavedViewId === sv.id)
      .onClick(() => {
        this.props.onSavedViewSelect(sv.id)
      })
      .onContextMenu((e) => {
        e.preventDefault()
        const menu = new Menu()
        menu.addItem((item) =>
          item
            .setTitle('Update with current filters')
            .setIcon('refresh-cw')
            .onClick(safeAsync(() => this.props.onSavedViewUpdate(sv.id)))
        )
        menu.addItem((item) =>
          item
            .setTitle('Delete view')
            .setIcon('trash')
            .onClick(safeAsync(() => this.props.onSavedViewDelete(sv.id)))
        )
        menu.showAtMouseEvent(e)
      })
  }

  private renderSaveViewAction(parent: HTMLElement): void {
    if (!isFilterActive(this.props.filter) && !this.props.filter.showArchived) return

    const saveBtn = new ButtonComponent(parent).setButtonText('+ save view')
    saveBtn.onClick(() => this.beginInlineSave(parent, saveBtn))
  }

  private beginInlineSave(parent: HTMLElement, saveBtn: ButtonComponent): void {
    saveBtn.buttonEl.addClass('pm-hidden')
    const wrapper = parent.createDiv('pm-project-header-save-input')
    const input = wrapper.createEl('input', {
      type: 'text',
      placeholder: 'View name…',
      cls: 'pm-project-header-save-input-field'
    })
    input.focus()

    let committed = false
    const restore = () => {
      wrapper.remove()
      saveBtn.buttonEl.removeClass('pm-hidden')
    }
    const commit = safeAsync(async () => {
      if (committed) return
      committed = true
      const name = input.value.trim()
      if (!name) {
        restore()
        return
      }
      await this.props.onSavedViewSave(name)
    })

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commit()
      } else if (e.key === 'Escape') {
        restore()
      }
    })
    input.addEventListener('blur', () => {
      if (input.value.trim()) commit()
      else restore()
    })
  }

  private renderFilterToggle(parent: HTMLElement): void {
    const isFilterRowVisible =
      this.props.filterRowExpanded || isFilterActive(this.props.filter) || this.props.filter.showArchived
    const pill = new Pill(parent)
      .setLabel('Filter')
      .setActive(isFilterRowVisible)
      .setAriaLabel('Toggle filter row')
      .onClick(() => {
        this.props.onToggleFilterRow()
      })
    pill.el.addClass('pm-project-header-filter-toggle')
  }
}

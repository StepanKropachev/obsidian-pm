import { ButtonComponent, Menu } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project, FilterState, SavedView } from '../../types'
import { makeId, makeDefaultFilter } from '../../types'
import { Pill } from '../../ui/primitives/Pill'
import { safeAsync } from '../../utils'

export interface SavedViewsContext {
  project: Project
  plugin: PMPlugin
  filter: FilterState
  sortKey: string
  sortDir: 'asc' | 'desc'
  activeSavedViewId: string | null
  setActiveSavedViewId: (id: string | null) => void
  setFilter: (f: FilterState) => void
  setSort: (key: string, dir: string) => void
  rerender: () => void
}

export function hasActiveFilters(filter: FilterState): boolean {
  return !!(
    filter.text ||
    filter.statuses.length ||
    filter.priorities.length ||
    filter.assignees.length ||
    filter.tags.length ||
    filter.dueDateFilter !== 'any' ||
    filter.showArchived
  )
}

export function renderSavedViewsBar(container: HTMLElement, ctx: SavedViewsContext): void {
  if (!ctx.project.savedViews.length && !hasActiveFilters(ctx.filter)) return

  const bar = container.createDiv('pm-saved-views-bar')

  // "All" pill
  new Pill(bar)
    .setLabel('All')
    .setShape('pill')
    .setActive(!ctx.activeSavedViewId)
    .onClick(() => {
      ctx.setActiveSavedViewId(null)
      ctx.setFilter(makeDefaultFilter())
      ctx.setSort('status', 'asc')
      ctx.rerender()
    })

  for (const sv of ctx.project.savedViews) {
    new Pill(bar)
      .setLabel(sv.name)
      .setShape('pill')
      .setActive(ctx.activeSavedViewId === sv.id)
      .onClick(() => {
        ctx.setActiveSavedViewId(sv.id)
        ctx.setFilter({ ...sv.filter })
        ctx.setSort(sv.sortKey, sv.sortDir)
        ctx.rerender()
      })
      .onContextMenu((e) => {
        e.preventDefault()
        const menu = new Menu()
        menu.addItem((item) =>
          item
            .setTitle('Update with current filters')
            .setIcon('refresh-cw')
            .onClick(
              safeAsync(async () => {
                sv.filter = { ...ctx.filter }
                sv.sortKey = ctx.sortKey
                sv.sortDir = ctx.sortDir
                await ctx.plugin.store.saveProject(ctx.project)
                ctx.rerender()
              })
            )
        )
        menu.addItem((item) =>
          item
            .setTitle('Delete view')
            .setIcon('trash')
            .onClick(
              safeAsync(async () => {
                ctx.project.savedViews = ctx.project.savedViews.filter((v) => v.id !== sv.id)
                if (ctx.activeSavedViewId === sv.id) ctx.setActiveSavedViewId(null)
                await ctx.plugin.store.saveProject(ctx.project)
                ctx.rerender()
              })
            )
        )
        menu.showAtMouseEvent(e)
      })
  }

  // "+ Save View" action
  if (hasActiveFilters(ctx.filter)) {
    const saveBtn = new ButtonComponent(bar).setButtonText('+ save view').onClick(() => {
      // Replace button with inline input (prompt() doesn't work in Electron)
      saveBtn.buttonEl.addClass('pm-hidden')
      const wrapper = bar.createDiv('pm-saved-view-inline-input')
      const input = wrapper.createEl('input', {
        type: 'text',
        placeholder: 'View name…',
        cls: 'pm-saved-view-name-input'
      })
      input.focus()

      let committed = false
      const commit = safeAsync(async () => {
        if (committed) return
        committed = true
        const name = input.value.trim()
        if (!name) {
          wrapper.remove()
          saveBtn.buttonEl.removeClass('pm-hidden')
          return
        }
        const sv: SavedView = {
          id: makeId(),
          name,
          filter: { ...ctx.filter },
          sortKey: ctx.sortKey,
          sortDir: ctx.sortDir
        }
        ctx.project.savedViews.push(sv)
        ctx.setActiveSavedViewId(sv.id)
        await ctx.plugin.store.saveProject(ctx.project)
        ctx.rerender()
      })

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
        if (e.key === 'Escape') {
          wrapper.remove()
          saveBtn.buttonEl.removeClass('pm-hidden')
        }
      })
      input.addEventListener('blur', () => {
        if (input.value.trim()) commit()
        else {
          wrapper.remove()
          saveBtn.buttonEl.removeClass('pm-hidden')
        }
      })
    })
  }
}

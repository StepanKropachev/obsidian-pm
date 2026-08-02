import type PMPlugin from '../../main'
import type { Project, FilterState, PriorityConfig, StatusConfig } from '../../types'
import { type FlatTask, flattenTasks } from '../../store/TaskTreeOps'
import { findTaskById } from '../../store/TaskIndex'
import { applyTaskFilterFlat, isFilterActive } from '../../store/TaskFilter'
import { openTaskModal } from '../../ui/ModalFactory'
import { renderAddButton } from '../../ui/composites/addButton'
import { compareTask } from './TableFilters'
import { renderTaskRow, updateSelectedRow, updateSelectAllCheckbox } from './TableRow'

type SortKey = 'title' | 'status' | 'priority' | 'due' | 'assignees' | 'progress'
type SortDir = 'asc' | 'desc'

export type { SortKey, SortDir }

export interface TableState {
  sortKey: SortKey
  sortDir: SortDir
  filter: FilterState
  selectedTaskId: string | null
  selectedTaskIds: Set<string>
  lastCheckedTaskId: string | null
  tableBody: HTMLElement | null
  wrapper: HTMLElement | null
  /** Display list after filter/sort/collapse. Drives the virtual window and selection. */
  visibleRows: FlatTask[]
  /** An estimate until calibrated against the first painted row. */
  rowHeight: number
  heightCalibrated: boolean
  /** Bounds of the rendered window into visibleRows. -1 forces a repaint. */
  windowStart: number
  windowEnd: number
  renderWindow: (() => void) | null
}

export interface TableContext {
  container: HTMLElement
  project: Project
  plugin: PMPlugin
  /** Resolved once per render pass. */
  statuses: StatusConfig[]
  priorities: PriorityConfig[]
  state: TableState
  onRefresh: () => Promise<void>
  onSelectionChange: () => void
  onBulkDelete: () => void
}

export function renderTable(ctx: TableContext): void {
  const wrapper = ctx.container.createDiv('pm-table-wrapper')
  ctx.state.wrapper = wrapper
  let scrollScheduled = false
  wrapper.addEventListener('scroll', () => {
    if (scrollScheduled) return
    scrollScheduled = true
    window.requestAnimationFrame(() => {
      scrollScheduled = false
      // Rebuilding the tbody nudges scrollTop near the edges, firing another scroll
      // event; repainting only on a real move stops that feeding back forever.
      const { start, end } = computeWindow(ctx.state)
      if (start === ctx.state.windowStart && end === ctx.state.windowEnd) return
      ctx.state.renderWindow?.()
    })
  })
  const table = wrapper.createEl('table', { cls: 'pm-table' })

  const thead = table.createEl('thead')
  const hrow = thead.createEl('tr')

  const selectAllTh = hrow.createEl('th', { cls: 'pm-table-cell-select' })
  const selectAllCb = selectAllTh.createEl('input', { type: 'checkbox', cls: 'pm-select-all-checkbox' })
  selectAllCb.addEventListener('change', () => {
    const ids = getVisibleTaskIds(ctx.state)
    if (selectAllCb.checked) {
      for (const id of ids) ctx.state.selectedTaskIds.add(id)
    } else {
      ctx.state.selectedTaskIds.clear()
    }
    updateSelectCheckboxes(ctx.state)
    ctx.onSelectionChange()
  })

  const cols: { key: SortKey | null; label: string; width?: string }[] = [
    { key: null, label: '', width: '32px' },
    { key: 'title', label: 'Task', width: 'auto' },
    { key: 'status', label: 'Status', width: '130px' },
    { key: 'priority', label: 'Priority', width: '110px' },
    { key: 'assignees', label: 'Assignees', width: '140px' },
    { key: 'due', label: 'Due', width: '110px' },
    { key: 'progress', label: 'Progress', width: '120px' },
    { key: null, label: 'Time', width: '90px' }
  ]
  const sortableHeaders: { key: SortKey; th: HTMLElement }[] = []
  const paintSortIndicators = () => {
    for (const { key, th } of sortableHeaders) {
      th.querySelector('.pm-sort-indicator')?.remove()
      if (ctx.state.sortKey === key) {
        th.createSpan({
          text: ctx.state.sortDir === 'asc' ? ' \u2191' : ' \u2193',
          cls: 'pm-sort-indicator'
        })
      }
    }
  }

  for (const col of cols) {
    const th = hrow.createEl('th')
    if (col.width) th.setCssStyles({ width: col.width })
    if (col.key) {
      th.addClass('pm-table-th-sortable')
      th.setAttribute('role', 'button')
      th.setAttribute('aria-label', `Sort by ${col.label}`)
      th.createSpan({ text: col.label })
      sortableHeaders.push({ key: col.key, th })
      th.addEventListener('click', () => {
        if (ctx.state.sortKey === col.key) {
          ctx.state.sortDir = ctx.state.sortDir === 'asc' ? 'desc' : 'asc'
        } else {
          ctx.state.sortKey = col.key as SortKey
          ctx.state.sortDir = 'asc'
        }
        paintSortIndicators()
        refreshTableBody(ctx)
      })
    } else {
      th.setText(col.label)
    }
  }
  paintSortIndicators()

  for (const cf of ctx.project.customFields) {
    const th = hrow.createEl('th', { text: cf.name })
    th.setCssStyles({ width: '120px' })
  }

  // Actions column, which must stay last.
  const actionsTh = hrow.createEl('th')
  actionsTh.setCssStyles({ width: '40px' })

  ctx.state.tableBody = table.createEl('tbody')
  fillTableBody(ctx)
}

export function refreshTableBody(ctx: TableContext): void {
  if (ctx.state.tableBody) {
    fillTableBody(ctx)
  }
}

function fillTableBody(ctx: TableContext): void {
  const tbody = ctx.state.tableBody
  if (!tbody) return

  let flat = flattenTasks(ctx.project.tasks)
  const hasActiveFilter = isFilterActive(ctx.state.filter)
  flat = applyTaskFilterFlat(flat, ctx.state.filter, ctx.statuses)

  const filteredIds = new Set(flat.map((f) => f.task.id))

  // Group by parentId once, O(N), promoting orphans whose parent was filtered out.
  const childrenByParent = new Map<string | null, FlatTask[]>()
  for (const f of flat) {
    let bucket: string | null
    if (f.parentId === null) {
      bucket = null
    } else if (hasActiveFilter && !filteredIds.has(f.parentId)) {
      bucket = null
    } else {
      bucket = f.parentId
    }
    let list = childrenByParent.get(bucket)
    if (!list) {
      list = []
      childrenByParent.set(bucket, list)
    }
    list.push(f)
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => compareTask(a.task, b.task, ctx.state, ctx.statuses, ctx.priorities))
  }

  const sorted: FlatTask[] = []
  const addWithChildren = (parentId: string | null) => {
    const items = childrenByParent.get(parentId)
    if (!items) return
    for (const item of items) {
      sorted.push(item)
      addWithChildren(item.task.id)
    }
  }
  addWithChildren(null)

  // When filtering, show all matches regardless of collapsed parent.
  ctx.state.visibleRows = hasActiveFilter ? sorted : sorted.filter((f) => f.visible)
  ctx.state.renderWindow = () => renderWindowRows(ctx)
  // The data changed, so repaint even if the window bounds happen to match.
  ctx.state.windowStart = -1
  ctx.state.windowEnd = -1
  renderWindowRows(ctx)
}

const ROW_OVERSCAN = 8
export const ROW_HEIGHT_ESTIMATE = 36

/** The [start, end) slice of visibleRows to render at the current scroll position. */
function computeWindow(state: TableState): { start: number; end: number } {
  const wrapper = state.wrapper
  if (!wrapper) return { start: 0, end: state.visibleRows.length }
  const thead = wrapper.querySelector('thead')
  const headerHeight = thead instanceof HTMLElement ? thead.offsetHeight : 0
  const scrollTop = Math.max(0, wrapper.scrollTop - headerHeight)
  const viewHeight = wrapper.clientHeight || 600

  let start = Math.floor(scrollTop / state.rowHeight) - ROW_OVERSCAN
  if (start < 0) start = 0
  let end = Math.ceil((scrollTop + viewHeight) / state.rowHeight) + ROW_OVERSCAN
  if (end > state.visibleRows.length) end = state.visibleRows.length
  return { start, end }
}

/** Renders the viewport rows only, bracketed by spacers that keep the scrollbar honest. */
function renderWindowRows(ctx: TableContext): void {
  const { state } = ctx
  const tbody = state.tableBody
  if (!tbody) return

  const rows = state.visibleRows
  const colCount = 10 + ctx.project.customFields.length
  const { start, end } = computeWindow(state)
  state.windowStart = start
  state.windowEnd = end

  tbody.empty()
  if (start > 0) spacerRow(tbody, colCount, start * state.rowHeight)
  for (let i = start; i < end; i++) {
    renderTaskRow(tbody, rows[i].task, rows[i].depth, ctx)
  }
  if (end < rows.length) spacerRow(tbody, colCount, (rows.length - end) * state.rowHeight)

  const addRow = tbody.createEl('tr', { cls: 'pm-table-add-row' })
  const addCell = addRow.createEl('td', { attr: { colspan: String(colCount) } })
  renderAddButton(addCell, 'Add task', () => {
    openTaskModal(ctx.plugin, ctx.project, { onSave: () => ctx.onRefresh() })
  })

  // Calibrate exactly once. Row heights are not perfectly uniform, so re-measuring
  // every pass feeds back into the window math and oscillates.
  if (!state.heightCalibrated) {
    const first = tbody.querySelector('tr[data-task-id]')
    if (first instanceof HTMLElement && first.offsetHeight > 0) {
      state.heightCalibrated = true
      if (Math.abs(first.offsetHeight - state.rowHeight) > 0.5) {
        state.rowHeight = first.offsetHeight
        renderWindowRows(ctx)
      }
    }
  }
}

function spacerRow(tbody: HTMLElement, colCount: number, height: number): void {
  const tr = tbody.createEl('tr', { cls: 'pm-table-spacer' })
  const td = tr.createEl('td', { attr: { colspan: String(colCount) } })
  td.setCssStyles({ height: `${height}px` })
}

export function updateSelectCheckboxes(state: TableState): void {
  if (!state.tableBody) return
  const rows = state.tableBody.querySelectorAll('tr[data-task-id]')
  for (const row of Array.from(rows)) {
    const id = (row as HTMLElement).dataset.taskId
    if (id === undefined) continue
    const cb = row.querySelector('.pm-select-checkbox')
    if (cb) (cb as HTMLInputElement).checked = state.selectedTaskIds.has(id)
  }
  updateSelectAllCheckbox(state)
}

export function handleTableKeyDown(e: KeyboardEvent, ctx: TableContext): void {
  const active = activeDocument.activeElement
  const isInput =
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLElement && active.contentEditable === 'true')

  if (e.key === 'Escape') {
    if (isInput) {
      active.blur()
      return
    }
    if (ctx.state.selectedTaskIds.size > 0) {
      ctx.state.selectedTaskIds.clear()
      updateSelectCheckboxes(ctx.state)
      ctx.onSelectionChange()
      return
    }
    ctx.state.selectedTaskId = null
    updateSelectedRow(ctx.state)
    return
  }

  if (isInput) return

  const rows = getVisibleTaskIds(ctx.state)
  if (!rows.length) return

  switch (e.key) {
    case 'ArrowDown':
    case 'j': {
      e.preventDefault()
      const idx = ctx.state.selectedTaskId ? rows.indexOf(ctx.state.selectedTaskId) : -1
      const next = Math.min(idx + 1, rows.length - 1)
      ctx.state.selectedTaskId = rows[next]
      updateSelectedRow(ctx.state)
      break
    }
    case 'ArrowUp':
    case 'k': {
      e.preventDefault()
      const idx = ctx.state.selectedTaskId ? rows.indexOf(ctx.state.selectedTaskId) : rows.length
      const prev = Math.max(idx - 1, 0)
      ctx.state.selectedTaskId = rows[prev]
      updateSelectedRow(ctx.state)
      break
    }
    case 'Enter':
    case 'e': {
      if (!ctx.state.selectedTaskId) return
      e.preventDefault()
      const task = findTaskById(ctx.project, ctx.state.selectedTaskId)
      if (task) {
        openTaskModal(ctx.plugin, ctx.project, {
          task,
          onSave: async () => {
            await ctx.onRefresh()
          }
        })
      }
      break
    }
    case 'Delete':
    case 'Backspace': {
      e.preventDefault()
      if (ctx.state.selectedTaskIds.size > 0) {
        ctx.onBulkDelete()
        break
      }
      if (!ctx.state.selectedTaskId) return
      const id = ctx.state.selectedTaskId
      const currentIdx = rows.indexOf(id)
      const nextIdx = currentIdx < rows.length - 1 ? currentIdx + 1 : currentIdx - 1
      ctx.state.selectedTaskId = nextIdx >= 0 ? rows[nextIdx] : null
      void deleteTask(id, ctx)
      break
    }
  }
}

export function getVisibleTaskIds(state: TableState): string[] {
  return state.visibleRows.map((f) => f.task.id)
}

async function deleteTask(id: string, ctx: TableContext): Promise<void> {
  await ctx.plugin.store.deleteTask(ctx.project, id)
  await ctx.onRefresh()
}

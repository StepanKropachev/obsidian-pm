import type PMPlugin from '../../main'
import type { Project, FilterState } from '../../types'
import { type FlatTask, flattenTasks } from '../../store/TaskTreeOps'
import { findTaskById } from '../../store/TaskIndex'
import { applyTaskFilterFlat, isFilterActive } from '../../store/TaskFilter'
import { openTaskModal } from '../../ui/ModalFactory'
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
  /** Scroll container (.pm-table-wrapper). Set by renderTable. */
  wrapper: HTMLElement | null
  /** Display list after filter/sort/collapse. Source of truth for the virtual window and selection. */
  visibleRows: FlatTask[]
  /** Row height in px. Starts as an estimate; calibrated once from the first painted row. */
  rowHeight: number
  /** True once rowHeight has been measured from a real row. */
  heightCalibrated: boolean
  /** Bounds of the currently rendered window into visibleRows. -1 forces a repaint. */
  windowStart: number
  windowEnd: number
  /** Re-renders the current virtual window. Wired by fillTableBody. */
  renderWindow: (() => void) | null
}

export interface TableContext {
  container: HTMLElement
  project: Project
  plugin: PMPlugin
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
      // Repaint only when the visible window actually moved. Rebuilding the
      // tbody can itself nudge scrollTop (clamping near the edges), which
      // fires another scroll event — without this guard that feeds back into
      // an endless repaint loop.
      const { start, end } = computeWindow(ctx.state)
      if (start === ctx.state.windowStart && end === ctx.state.windowEnd) return
      ctx.state.renderWindow?.()
    })
  })
  const table = wrapper.createEl('table', { cls: 'pm-table' })

  // Header
  const thead = table.createEl('thead')
  const hrow = thead.createEl('tr')

  // Select-all checkbox
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
  for (const col of cols) {
    const th = hrow.createEl('th')
    if (col.width) th.setCssStyles({ width: col.width })
    if (col.key) {
      th.addClass('pm-table-th-sortable')
      th.setAttribute('role', 'button')
      th.setAttribute('aria-label', `Sort by ${col.label}`)
      th.createSpan({ text: col.label })
      if (ctx.state.sortKey === col.key) {
        th.createSpan({
          text: ctx.state.sortDir === 'asc' ? ' \u2191' : ' \u2193',
          cls: 'pm-sort-indicator'
        })
      }
      th.addEventListener('click', () => {
        if (ctx.state.sortKey === col.key) {
          ctx.state.sortDir = ctx.state.sortDir === 'asc' ? 'desc' : 'asc'
        } else {
          ctx.state.sortKey = col.key as SortKey
          ctx.state.sortDir = 'asc'
        }
        refreshTableBody(ctx)
      })
    } else {
      th.setText(col.label)
    }
  }

  for (const cf of ctx.project.customFields) {
    const th = hrow.createEl('th', { text: cf.name })
    th.setCssStyles({ width: '120px' })
  }

  // Actions column header (must be last)
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
  flat = applyTaskFilterFlat(flat, ctx.state.filter, ctx.plugin.settings.statuses)

  const filteredIds = new Set(flat.map((f) => f.task.id))

  // Pre-group by parentId once: O(N) tree walk instead of O(N^2).
  // Orphans whose parent got filtered out get promoted to root.
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
    list.sort((a, b) =>
      compareTask(a.task, b.task, ctx.state, ctx.plugin.settings.statuses, ctx.plugin.settings.priorities)
    )
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
  // Data changed: always repaint, even if the window bounds happen to match.
  ctx.state.windowStart = -1
  ctx.state.windowEnd = -1
  renderWindowRows(ctx)
}

const ROW_OVERSCAN = 8
export const ROW_HEIGHT_ESTIMATE = 36

/** Compute the [start, end) slice of visibleRows that should be rendered for the current scroll position. */
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

/**
 * Render only the rows inside the scroll viewport (plus overscan), bracketed
 * by spacer rows sized to keep the scrollbar honest. Render cost is
 * O(viewport), independent of project size.
 */
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

  // "Add task" row
  const addRow = tbody.createEl('tr', { cls: 'pm-table-add-row' })
  const addCell = addRow.createEl('td', { attr: { colspan: String(colCount) } })
  const addBtn = addCell.createEl('button', { text: '+ add task', cls: 'pm-table-add-btn' })
  addBtn.addEventListener('click', () => {
    openTaskModal(ctx.plugin, ctx.project, { onSave: () => ctx.onRefresh() })
  })

  // Calibrate the estimated row height against a real painted row, exactly
  // once. Re-calibrating on every pass feeds back into the window math (row
  // heights are not perfectly uniform) and can oscillate forever.
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

// ─── Keyboard handling ──────────────────────────────────────────────────────

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

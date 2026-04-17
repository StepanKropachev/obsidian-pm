import type PMPlugin from '../../main';
import type { Project, FilterState } from '../../types';
import { type FlatTask, flattenTasks, findTask } from '../../store/TaskTreeOps';
import { openTaskModal } from '../../ui/ModalFactory';
import { focusQuickAdd } from './QuickAddBar';
import { applyFilters, isFilterActive, compareTask } from './TableFilters';
import { renderTaskRow, updateSelectedRow, updateSelectAllCheckbox } from './TableRow';

type SortKey = 'title' | 'status' | 'priority' | 'due' | 'assignees' | 'progress';
type SortDir = 'asc' | 'desc';

export type { SortKey, SortDir };

export interface TableState {
  sortKey: SortKey;
  sortDir: SortDir;
  filter: FilterState;
  selectedTaskId: string | null;
  selectedTaskIds: Set<string>;
  lastCheckedTaskId: string | null;
  tableBody: HTMLElement | null;
}

export interface TableContext {
  container: HTMLElement;
  project: Project;
  plugin: PMPlugin;
  state: TableState;
  onRefresh: () => Promise<void>;
  onSelectionChange: () => void;
  onBulkDelete: () => void;
}

export function renderTable(ctx: TableContext): void {
  const wrapper = ctx.container.createDiv('pm-table-wrapper');
  const table = wrapper.createEl('table', { cls: 'pm-table' });

  // Header
  const thead = table.createEl('thead');
  const hrow = thead.createEl('tr');

  // Select-all checkbox
  const selectAllTh = hrow.createEl('th', { cls: 'pm-table-cell-select' });
  const selectAllCb = selectAllTh.createEl('input', { type: 'checkbox', cls: 'pm-select-all-checkbox' });
  selectAllCb.addEventListener('change', () => {
    const ids = getVisibleTaskIds(ctx.state);
    if (selectAllCb.checked) {
      for (const id of ids) ctx.state.selectedTaskIds.add(id);
    } else {
      ctx.state.selectedTaskIds.clear();
    }
    updateSelectCheckboxes(ctx.state);
    ctx.onSelectionChange();
  });

  const cols: { key: SortKey | null; label: string; width?: string }[] = [
    { key: null,        label: '',          width: '32px'  },
    { key: 'title',     label: 'Task',      width: 'auto'  },
    { key: 'status',    label: 'Status',    width: '130px' },
    { key: 'priority',  label: 'Priority',  width: '110px' },
    { key: 'assignees', label: 'Assignees', width: '140px' },
    { key: 'due',       label: 'Due',       width: '110px' },
    { key: 'progress',  label: 'Progress',  width: '120px' },
    { key: null,        label: 'Time',      width: '90px'  },
  ];
  for (const col of cols) {
    const th = hrow.createEl('th');
    if (col.width) th.setCssStyles({ width: col.width });
    if (col.key) {
      th.addClass('pm-table-th-sortable');
      th.setAttribute('role', 'button');
      th.setAttribute('aria-label', `Sort by ${col.label}`);
      th.createEl('span', { text: col.label });
      if (ctx.state.sortKey === col.key) {
        th.createEl('span', {
          text: ctx.state.sortDir === 'asc' ? ' \u2191' : ' \u2193',
          cls: 'pm-sort-indicator',
        });
      }
      th.addEventListener('click', () => {
        if (ctx.state.sortKey === col.key) {
          ctx.state.sortDir = ctx.state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          ctx.state.sortKey = col.key as SortKey;
          ctx.state.sortDir = 'asc';
        }
        refreshTableBody(ctx);
      });
    } else {
      th.setText(col.label);
    }
  }

  for (const cf of ctx.project.customFields) {
    const th = hrow.createEl('th', { text: cf.name });
    th.setCssStyles({ width: '120px' });
  }

  // Actions column header (must be last)
  const actionsTh = hrow.createEl('th');
  actionsTh.setCssStyles({ width: '40px' });

  ctx.state.tableBody = table.createEl('tbody');
  fillTableBody(ctx);
}

export function refreshTableBody(ctx: TableContext): void {
  if (ctx.state.tableBody) {
    fillTableBody(ctx);
  }
}

function fillTableBody(ctx: TableContext): void {
  const tbody = ctx.state.tableBody;
  if (!tbody) return;
  tbody.empty();

  let flat = flattenTasks(ctx.project.tasks);
  const hasActiveFilter = isFilterActive(ctx.state.filter);
  flat = applyFilters(flat, ctx.state.filter, ctx.plugin.settings.statuses);

  // Build set of IDs present after filtering
  const filteredIds = new Set(flat.map(f => f.task.id));

  // Sort with hierarchy
  const sorted: FlatTask[] = [];
  const addWithChildren = (parentId: string | null) => {
    // Include items whose parentId matches, OR whose parent was filtered out (promote to this level)
    const items = flat.filter(f =>
      f.parentId === parentId ||
      (hasActiveFilter && f.parentId !== null && !filteredIds.has(f.parentId) && parentId === null)
    );
    items.sort((a, b) => compareTask(a.task, b.task, ctx.state, ctx.plugin.settings.statuses));
    for (const item of items) {
      sorted.push(item);
      addWithChildren(item.task.id);
    }
  };
  addWithChildren(null);

  for (const { task, depth, parentId, visible } of sorted) {
    // When filtering, show all matches regardless of collapsed parent
    if (!hasActiveFilter && !visible) continue;
    renderTaskRow(tbody, task, depth, hasActiveFilter ? null : parentId, ctx);
  }

  // "Add task" row
  const addRow = tbody.createEl('tr', { cls: 'pm-table-add-row' });
  const addCell = addRow.createEl('td', { attr: { colspan: String(10 + ctx.project.customFields.length) } });
  const addBtn = addCell.createEl('button', { text: '+ add task', cls: 'pm-table-add-btn' });
  addBtn.addEventListener('click', () => {
    openTaskModal(ctx.plugin, ctx.project, { onSave: () => ctx.onRefresh() });
  });
}

export function updateSelectCheckboxes(state: TableState): void {
  if (!state.tableBody) return;
  const rows = state.tableBody.querySelectorAll('tr[data-task-id]');
  for (const row of Array.from(rows)) {
    const id = (row as HTMLElement).dataset.taskId!;
    const cb = row.querySelector('.pm-select-checkbox');
    if (cb) (cb as HTMLInputElement).checked = state.selectedTaskIds.has(id);
  }
  updateSelectAllCheckbox(state);
}

// ─── Keyboard handling ──────────────────────────────────────────────────────

export function handleTableKeyDown(e: KeyboardEvent, ctx: TableContext): void {
  const active = document.activeElement;
  const isInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ||
                  (active instanceof HTMLElement && active.contentEditable === 'true');

  if (e.key === 'Escape') {
    if (isInput) {
      (active as HTMLElement).blur();
      return;
    }
    if (ctx.state.selectedTaskIds.size > 0) {
      ctx.state.selectedTaskIds.clear();
      updateSelectCheckboxes(ctx.state);
      ctx.onSelectionChange();
      return;
    }
    ctx.state.selectedTaskId = null;
    updateSelectedRow(ctx.state);
    return;
  }

  if (isInput) return;

  const rows = getVisibleTaskIds(ctx.state);
  if (!rows.length) return;

  switch (e.key) {
    case 'ArrowDown':
    case 'j': {
      e.preventDefault();
      const idx = ctx.state.selectedTaskId ? rows.indexOf(ctx.state.selectedTaskId) : -1;
      const next = Math.min(idx + 1, rows.length - 1);
      ctx.state.selectedTaskId = rows[next];
      updateSelectedRow(ctx.state);
      break;
    }
    case 'ArrowUp':
    case 'k': {
      e.preventDefault();
      const idx = ctx.state.selectedTaskId ? rows.indexOf(ctx.state.selectedTaskId) : rows.length;
      const prev = Math.max(idx - 1, 0);
      ctx.state.selectedTaskId = rows[prev];
      updateSelectedRow(ctx.state);
      break;
    }
    case 'Enter':
    case 'e': {
      if (!ctx.state.selectedTaskId) return;
      e.preventDefault();
      const task = findTask(ctx.project.tasks, ctx.state.selectedTaskId);
      if (task) {
        openTaskModal(ctx.plugin, ctx.project, { task, onSave: async () => { await ctx.onRefresh(); } });
      }
      break;
    }
    case 'n':
    case 'N': {
      e.preventDefault();
      focusQuickAdd(ctx.container);
      break;
    }
    case 'Delete':
    case 'Backspace': {
      e.preventDefault();
      if (ctx.state.selectedTaskIds.size > 0) {
        ctx.onBulkDelete();
        break;
      }
      if (!ctx.state.selectedTaskId) return;
      const id = ctx.state.selectedTaskId;
      const currentIdx = rows.indexOf(id);
      const nextIdx = currentIdx < rows.length - 1 ? currentIdx + 1 : currentIdx - 1;
      ctx.state.selectedTaskId = nextIdx >= 0 ? rows[nextIdx] : null;
      void deleteTask(id, ctx);
      break;
    }
  }
}

export function getVisibleTaskIds(state: TableState): string[] {
  if (!state.tableBody) return [];
  const rows = state.tableBody.querySelectorAll('tr[data-task-id]');
  return Array.from(rows).map(r => (r as HTMLElement).dataset.taskId!);
}

async function deleteTask(id: string, ctx: TableContext): Promise<void> {
  await ctx.plugin.store.deleteTask(ctx.project, id);
  await ctx.onRefresh();
}

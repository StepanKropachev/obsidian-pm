import type PMPlugin from '../main';
import type { Project, ProjectFilterState, ProjectStatus, TaskPriority } from '../types';
import { makeDefaultProjectFilter } from '../types';
import { renderFilterDropdown } from '../ui/FilterDropdown';

// Track whether the search input triggered the last re-render so we can restore focus
let _pendingSearchFocus = false;

// ─── Static option lists ──────────────────────────────────────────────────────

const STATUS_OPTIONS: { id: ProjectStatus; label: string }[] = [
  { id: 'draft',     label: 'Draft'     },
  { id: 'active',    label: 'Active'    },
  { id: 'on-hold',   label: 'On hold'   },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

const PRIORITY_OPTIONS: { id: TaskPriority; label: string }[] = [
  { id: 'critical', label: 'Critical' },
  { id: 'high',     label: 'High'     },
  { id: 'medium',   label: 'Medium'   },
  { id: 'low',      label: 'Low'      },
];

// ─── Filter application ───────────────────────────────────────────────────────

export function applyProjectFilters(projects: Project[], f: ProjectFilterState): Project[] {
  let result = projects;

  if (f.text) {
    const q = f.text.toLowerCase();
    result = result.filter(p =>
      p.title.toLowerCase().includes(q) ||
      (p.client ?? '').toLowerCase().includes(q) ||
      (p.owner ?? '').toLowerCase().includes(q) ||
      (p.portfolio ?? '').toLowerCase().includes(q) ||
      (p.description ?? '').toLowerCase().includes(q),
    );
  }

  if (f.statuses.length) {
    result = result.filter(p => p.status && f.statuses.includes(p.status));
  }

  if (f.portfolios.length) {
    result = result.filter(p => p.portfolio && f.portfolios.includes(p.portfolio));
  }

  if (f.owners.length) {
    result = result.filter(p => p.owner && f.owners.includes(p.owner));
  }

  if (f.priorities.length) {
    result = result.filter(p => p.priority && f.priorities.includes(p.priority));
  }

  return result;
}

// ─── Filter bar renderer ──────────────────────────────────────────────────────

/**
 * Renders the shared project filter bar.
 * Mutates plugin.settings.projectFilterState when filters change; calls onChange() after.
 */
export function renderProjectFilterBar(
  container: HTMLElement,
  allProjects: Project[],
  plugin: PMPlugin,
  onChange: () => void,
): void {
  const f = plugin.settings.projectFilterState;
  const bar = container.createDiv('pm-project-filter-bar');

  // ── Search ─────────────────────────────────────────────────────────────────
  const search = bar.createEl('input', {
    type: 'text',
    placeholder: 'Search projects…',
    cls: 'pm-filter-input pm-project-filter-search',
  });
  search.value = f.text;

  // Restore focus if search triggered the last re-render (prevents losing focus on each keystroke)
  if (_pendingSearchFocus) {
    _pendingSearchFocus = false;
    requestAnimationFrame(() => {
      search.focus();
      const len = search.value.length;
      search.setSelectionRange(len, len);
    });
  }

  let debounce: number | null = null;
  search.addEventListener('input', () => {
    if (debounce !== null) window.clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      plugin.settings.projectFilterState.text = search.value;
      _pendingSearchFocus = true;
      onChange();
    }, 120);
  });

  // ── Status ─────────────────────────────────────────────────────────────────
  renderFilterDropdown(bar, 'Status', f.statuses,
    STATUS_OPTIONS,
    () => { void plugin.saveSettings(); onChange(); });

  // ── Portfolio (only when portfolios exist) ────────────────────────────────
  const allPortfolios = [...new Set(
    allProjects.map(p => p.portfolio).filter((g): g is string => !!g),
  )].sort();
  if (allPortfolios.length) {
    renderFilterDropdown(bar, 'Portfolio', f.portfolios,
      allPortfolios.map(g => ({ id: g, label: g })),
      () => { void plugin.saveSettings(); onChange(); });
  }

  // ── Owner (only when owners exist) ────────────────────────────────────────
  const allOwners = [...new Set(
    allProjects.map(p => p.owner).filter((o): o is string => !!o),
  )].sort();
  if (allOwners.length) {
    renderFilterDropdown(bar, 'Owner', f.owners,
      allOwners.map(o => ({ id: o, label: o })),
      () => { void plugin.saveSettings(); onChange(); });
  }

  // ── Priority ───────────────────────────────────────────────────────────────
  renderFilterDropdown(bar, 'Priority', f.priorities,
    PRIORITY_OPTIONS,
    () => { void plugin.saveSettings(); onChange(); });

  // ── Clear button ───────────────────────────────────────────────────────────
  const activeCount = countActiveProjectFilters(f);
  if (activeCount > 0) {
    const clearBtn = bar.createEl('button', {
      text: `✕ Clear (${activeCount})`,
      cls: 'pm-btn pm-btn-ghost pm-btn-sm pm-filter-clear-btn',
    });
    clearBtn.addEventListener('click', () => {
      plugin.settings.projectFilterState = makeDefaultProjectFilter();
      void plugin.saveSettings();
      onChange();
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function countActiveProjectFilters(f: ProjectFilterState): number {
  return (f.text ? 1 : 0)
    + f.statuses.length
    + f.portfolios.length
    + f.owners.length
    + f.priorities.length;
}

import { TFile, Menu, ButtonComponent } from 'obsidian'
import type PMPlugin from '../main'
import type { Project } from '../types'
import type { ProjectRef } from '../store'
import { formatDateShort, safeAsync } from '../utils'
import { parsePlainDate, today } from '../dates'
import { EmptyState } from '../ui/primitives/EmptyState'
import { ProjectRow } from '../ui/composites/ProjectRow'
import type { DueUrgency } from '../ui/composites/dueChip'

/** The title column absorbs the leftover width so the rest hug their content. */
const COLUMNS: { label: string; cls?: string }[] = [
  { label: '' },
  { label: 'Project', cls: 'pm-project-th-title' },
  { label: 'Progress' },
  { label: 'Tasks' },
  { label: 'Members' },
  { label: 'Due' },
  { label: '' }
]

export interface ProjectListContext {
  plugin: PMPlugin
  toolbarEl: HTMLElement
  contentEl: HTMLElement
  openProject: (path: string) => Promise<void>
}

export function renderProjectListToolbar(ctx: ProjectListContext): void {
  ctx.toolbarEl.empty()
  const left = ctx.toolbarEl.createDiv('pm-toolbar-left')
  left.createEl('h2', { text: 'Projects', cls: 'pm-toolbar-title' })
  const line = countLine(ctx)
  if (line) left.createSpan({ cls: 'pm-project-list-count', text: line })

  new ButtonComponent(ctx.toolbarEl)
    .setButtonText('+ new project')
    .setCta()
    .onClick(safeAsync(() => ctx.plugin.router.openProjectCreate()))
}

function countLine(ctx: ProjectListContext): string {
  const refs = ctx.plugin.index.projectRefs()
  if (refs.length === 0) return ''
  const behind = refs.filter((ref) => ctx.plugin.index.dueSummary(ref).overdue > 0).length
  const bits = [refs.length === 1 ? '1 project' : `${refs.length} projects`]
  if (behind) bits.push(`${behind} with tasks past due`)
  return bits.join(' · ')
}

/** Draws from the index alone: a row needs a title, an icon and a few counts, not a load. */
export function renderProjectListContent(ctx: ProjectListContext): void {
  const roots = ctx.plugin.index.rootRefs()
  ctx.contentEl.empty()

  if (roots.length === 0) {
    // On a cold start the vault has not been read yet, and offering to create a first
    // project would be wrong in a vault that already has twenty.
    if (!ctx.plugin.index.ready) {
      new EmptyState(ctx.contentEl).setIcon('📋').setTitle('Looking for projects')
      return
    }
    new EmptyState(ctx.contentEl)
      .setIcon('📋')
      .setTitle('No projects yet')
      .setBody('Create your first project to get started.')
      .setAction(
        '+ new project',
        safeAsync(() => ctx.plugin.router.openProjectCreate())
      )
    return
  }

  const wrapper = ctx.contentEl.createDiv('pm-table-wrapper')
  const table = wrapper.createEl('table', { cls: 'pm-table pm-project-table' })
  const headRow = table.createEl('thead').createEl('tr')
  for (const column of COLUMNS) headRow.createEl('th', { text: column.label, cls: column.cls })
  renderRows(ctx, table.createEl('tbody'), roots, 0)
}

/** Sub-projects follow their parent, indented, unless the parent is collapsed. */
function renderRows(ctx: ProjectListContext, tbody: HTMLElement, refs: ProjectRef[], depth: number): void {
  const index = ctx.plugin.index
  for (const ref of refs) {
    const children = index.childRefs(ref.path)
    const collapsed = ctx.plugin.isProjectCollapsed(ref.path)
    // A parent's own numbers say little about the program under it.
    const { total, done } = children.length ? index.rollupCounts(ref) : index.counts(ref)
    const { overdue, latestDue } = children.length ? index.rollupDueSummary(ref) : index.dueSummary(ref)

    new ProjectRow(tbody, {
      title: ref.title,
      icon: ref.icon,
      color: ref.color,
      depth,
      childCount: children.length,
      collapsed,
      tasksDone: done,
      tasksTotal: total,
      overdue,
      members: ref.teamMembers,
      dueLabel: formatDateShort(latestDue),
      dueUrgency: urgencyOf(latestDue, overdue > 0),
      onToggleCollapsed: safeAsync(async () => {
        await ctx.plugin.toggleProjectCollapsed(ref.path)
        renderProjectListContent(ctx)
      }),
      onClick: safeAsync(() => ctx.openProject(ref.path)),
      onContextMenu: (e) => openProjectContextMenu(ctx, ref, e),
      onActions: (e) => openProjectContextMenu(ctx, ref, e)
    })

    if (children.length && !collapsed) renderRows(ctx, tbody, children, depth + 1)
  }
}

function urgencyOf(due: string, hasOverdue: boolean): DueUrgency {
  const date = parsePlainDate(due)
  if (!date) return 'normal'
  const days = today().until(date, { largestUnit: 'day' }).days
  if (days < 0) return hasOverdue ? 'overdue' : 'normal'
  return days < 3 ? 'near' : 'normal'
}

function openProjectContextMenu(ctx: ProjectListContext, ref: ProjectRef, e: MouseEvent): void {
  const menu = new Menu()
  menu.addItem((item) =>
    item
      .setTitle('Open tasks')
      .setIcon('table')
      .onClick(safeAsync(() => ctx.plugin.router.openScope({ kind: 'project', path: ref.path })))
  )
  if (ctx.plugin.index.childRefs(ref.path).length) {
    menu.addItem((item) =>
      item
        .setTitle('Open with sub-projects')
        .setIcon('layers')
        .onClick(safeAsync(() => ctx.plugin.router.openScope({ kind: 'subtree', path: ref.path })))
    )
  }
  menu.addItem((item) =>
    item
      .setTitle('Edit project')
      .setIcon('settings')
      .onClick(safeAsync(() => ctx.plugin.router.openProjectEdit(ref.path)))
  )
  menu.addItem((item) =>
    item
      .setTitle('Delete project')
      .setIcon('trash')
      .onClick(
        safeAsync(async () => {
          const project = await loadRef(ctx, ref)
          if (!project) return
          await ctx.plugin.store.deleteProject(project)
          renderProjectListContent(ctx)
        })
      )
  )
  menu.showAtMouseEvent(e)
}

async function loadRef(ctx: ProjectListContext, ref: ProjectRef): Promise<Project | null> {
  const file = ctx.plugin.app.vault.getAbstractFileByPath(ref.path)
  return file instanceof TFile ? ctx.plugin.store.loadProject(file) : null
}

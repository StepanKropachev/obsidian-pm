import { Menu, ButtonComponent } from 'obsidian'
import type PMPlugin from '../main'
import type { ProjectRef } from '../store'
import { formatDateShort } from '../dates'
import { dateUrgency, safeAsync } from '../utils'
import { openProjectCreate } from '../ui/ModalFactory'
import { EmptyState } from '../ui/primitives/EmptyState'
import { ProjectRow } from '../ui/composites/ProjectRow'
import { childTreeGuides } from '../ui/composites/treeGuides'
import { linkedRefs } from './linkedRefs'

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
    .onClick(() => openProjectCreate(ctx.plugin))
}

function countLine(ctx: ProjectListContext): string {
  const refs = ctx.plugin.index.projectRefs()
  if (refs.length === 0) return ''
  const behind = refs.filter((ref) => ctx.plugin.index.dueSummary(ref).overdue > 0).length
  const bits = [refs.length === 1 ? '1 project' : `${refs.length} projects`]
  if (behind) bits.push(`${behind} with tasks past due`)
  return bits.join(' · ')
}

export function renderProjectListContent(ctx: ProjectListContext): void {
  const roots = ctx.plugin.index.rootRefs()
  ctx.contentEl.empty()

  if (roots.length === 0) {
    if (!ctx.plugin.index.ready) {
      new EmptyState(ctx.contentEl).setIcon('📋').setTitle('Looking for projects')
      return
    }
    new EmptyState(ctx.contentEl)
      .setIcon('📋')
      .setTitle('No projects yet')
      .setBody('Create your first project to get started.')
      .setAction('+ new project', () => openProjectCreate(ctx.plugin))
    return
  }

  const wrapper = ctx.contentEl.createDiv('pm-table-wrapper')
  wrapper.setAttr('data-borders', ctx.plugin.settings.lineBorders)
  const table = wrapper.createEl('table', { cls: 'pm-table pm-project-table' })
  const headRow = table.createEl('thead').createEl('tr')
  for (const column of COLUMNS) headRow.createEl('th', { text: column.label, cls: column.cls })
  renderRows(ctx, table.createEl('tbody'), roots, [])
}

function renderRows(ctx: ProjectListContext, tbody: HTMLElement, refs: ProjectRef[], trail: boolean[]): void {
  const index = ctx.plugin.index
  refs.forEach((ref, i) => {
    const children = index.childRefs(ref.path)
    const collapsed = ctx.plugin.isProjectCollapsed(ref.path)
    const { total, done } = children.length ? index.rollupCounts(ref) : index.counts(ref)
    const { overdue, latestDue } = children.length ? index.rollupDueSummary(ref) : index.dueSummary(ref)
    const isLastChild = i === refs.length - 1

    new ProjectRow(tbody, {
      title: ref.title,
      icon: ref.icon,
      color: ref.color,
      depth: trail.length,
      treeGuides: ctx.plugin.settings.showSubtreeConnections ? trail : null,
      isLastChild,
      childCount: children.length,
      collapsed,
      tasksDone: done,
      tasksTotal: total,
      overdue,
      members: linkedRefs(ctx.plugin.app, ref.teamMembers, ref.path),
      dueLabel: formatDateShort(latestDue),
      dueUrgency: dateUrgency(latestDue, overdue > 0),
      onToggleCollapsed: safeAsync(async () => {
        await ctx.plugin.toggleProjectCollapsed(ref.path)
        renderProjectListContent(ctx)
      }),
      onClick: safeAsync(() => ctx.openProject(ref.path)),
      onContextMenu: (e) => openProjectContextMenu(ctx, ref, e),
      onActions: (e) => openProjectContextMenu(ctx, ref, e)
    })

    if (children.length && !collapsed) renderRows(ctx, tbody, children, childTreeGuides(trail, isLastChild))
  })
}

function openProjectContextMenu(ctx: ProjectListContext, ref: ProjectRef, e: MouseEvent): void {
  const menu = new Menu()
  menu.addItem((item) =>
    item
      .setTitle('Open overview')
      .setIcon('file-text')
      .onClick(safeAsync(() => ctx.plugin.router.openProjectOverview(ref.path)))
  )
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
      .setTitle('Duplicate project')
      .setIcon('copy')
      .onClick(
        safeAsync(async () => {
          const project = await ctx.plugin.store.loadProjectByPath(ref.path)
          if (!project) return
          await ctx.plugin.duplicateProjectFlow(project)
        })
      )
  )
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
          const project = await ctx.plugin.store.loadProjectByPath(ref.path)
          if (!project) return
          await ctx.plugin.store.deleteProject(project)
          renderProjectListContent(ctx)
        })
      )
  )
  menu.showAtMouseEvent(e)
}

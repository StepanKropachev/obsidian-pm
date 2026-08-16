import { TFile, Menu, ButtonComponent } from 'obsidian'
import type PMPlugin from '../main'
import type { Project } from '../types'
import type { ProjectRef } from '../store'
import { safeAsync } from '../utils'
import { createProject } from './createProject'
import { EmptyState } from '../ui/primitives/EmptyState'
import { ProjectCard } from '../ui/composites/ProjectCard'

export interface ProjectListContext {
  plugin: PMPlugin
  toolbarEl: HTMLElement
  contentEl: HTMLElement
  openProjectFile: (file: TFile) => Promise<void>
}

export function renderProjectListToolbar(ctx: ProjectListContext): void {
  ctx.toolbarEl.empty()
  ctx.toolbarEl.createEl('h2', { text: 'Project manager', cls: 'pm-toolbar-title' })

  new ButtonComponent(ctx.toolbarEl)
    .setButtonText('+ new project')
    .setCta()
    .onClick(
      safeAsync(async () => {
        await createProject(ctx.plugin)
      })
    )
}

/** Draws from the index alone: a card needs a title, an icon and two counts, not a load. */
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
        safeAsync(async () => {
          await createProject(ctx.plugin)
        })
      )
    return
  }

  renderProjectCards(ctx, ctx.contentEl.createDiv('pm-project-grid'), roots)
}

/**
 * A project with sub-projects takes a row of its own, with the children indented directly
 * beneath it. Otherwise a parent at the end of a row and its children at the start of the
 * next one read as unrelated.
 */
function renderProjectCards(ctx: ProjectListContext, grid: HTMLElement, refs: ProjectRef[]): void {
  const index = ctx.plugin.index
  for (const ref of refs) {
    const children = index.childRefs(ref.path)
    const collapsed = ctx.plugin.isProjectCollapsed(ref.path)
    const host = children.length ? grid.createDiv('pm-project-branch') : grid
    // A parent's own count says little about the program under it.
    const { total, done } = children.length ? index.rollupCounts(ref) : index.counts(ref)
    new ProjectCard(host, {
      title: ref.title,
      icon: ref.icon,
      color: ref.color,
      tasksDone: done,
      tasksTotal: total,
      childCount: children.length,
      collapsed,
      onToggleCollapsed: safeAsync(async () => {
        await ctx.plugin.toggleProjectCollapsed(ref.path)
        renderProjectListContent(ctx)
      }),
      onClick: safeAsync(async () => {
        const file = ctx.plugin.app.vault.getAbstractFileByPath(ref.path)
        if (file instanceof TFile) await ctx.openProjectFile(file)
      }),
      onContextMenu: (e) => openProjectContextMenu(ctx, ref, e)
    })
    if (children.length && !collapsed) {
      const nested = host.createDiv('pm-project-children')
      renderProjectCards(ctx, nested.createDiv('pm-project-grid'), children)
    }
  }
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

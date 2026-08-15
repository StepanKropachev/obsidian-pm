import { TFile, Menu, ButtonComponent } from 'obsidian'
import type PMPlugin from '../main'
import type { Project } from '../types'
import type { ProjectRef } from '../store'
import { safeAsync } from '../utils'
import { openProjectModal } from '../ui/ModalFactory'
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
    .onClick(() => openCreateProjectModal(ctx))
}

/** Draws from the index alone: a card needs a title, an icon and two counts, not a load. */
export function renderProjectListContent(ctx: ProjectListContext): void {
  const projects = ctx.plugin.index.projectRefs()
  ctx.contentEl.empty()

  if (projects.length === 0) {
    new EmptyState(ctx.contentEl)
      .setIcon('📋')
      .setTitle('No projects yet')
      .setBody('Create your first project to get started.')
      .setAction('+ new project', () => openCreateProjectModal(ctx))
    return
  }

  const grid = ctx.contentEl.createDiv('pm-project-grid')
  for (const project of projects) {
    const { total, done } = ctx.plugin.index.counts(project)
    new ProjectCard(grid, {
      title: project.title,
      icon: project.icon,
      color: project.color,
      tasksDone: done,
      tasksTotal: total,
      onClick: safeAsync(async () => {
        const file = ctx.plugin.app.vault.getAbstractFileByPath(project.path)
        if (file instanceof TFile) await ctx.openProjectFile(file)
      }),
      onContextMenu: (e) => openProjectContextMenu(ctx, project, e)
    })
  }
}

function openCreateProjectModal(ctx: ProjectListContext): void {
  openProjectModal(ctx.plugin, {
    onSave: async (project) => {
      const file = ctx.plugin.app.vault.getAbstractFileByPath(project.filePath)
      if (file instanceof TFile) await ctx.openProjectFile(file)
    }
  })
}

function openProjectContextMenu(ctx: ProjectListContext, ref: ProjectRef, e: MouseEvent): void {
  const menu = new Menu()
  menu.addItem((item) =>
    item
      .setTitle('Edit project')
      .setIcon('settings')
      .onClick(
        safeAsync(async () => {
          const project = await loadRef(ctx, ref)
          if (!project) return
          openProjectModal(ctx.plugin, {
            project,
            onSave: () => renderProjectListContent(ctx)
          })
        })
      )
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

import { TFile, Menu, ButtonComponent } from 'obsidian'
import type PMPlugin from '../main'
import type { Project, Task, StatusConfig } from '../types'
import { safeAsync, isTerminalStatus } from '../utils'
import { openProjectModal } from '../ui/ModalFactory'
import { EmptyState } from '../ui/primitives/EmptyState'
import { ProjectCard } from '../ui/composites/ProjectCard'

export interface ProjectListContext {
  plugin: PMPlugin
  toolbarEl: HTMLElement
  contentEl: HTMLElement
  isStale: () => boolean
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

export async function renderProjectListContent(ctx: ProjectListContext): Promise<void> {
  const projects = await ctx.plugin.store.loadAllProjects(ctx.plugin.settings.projectsFolder)
  if (ctx.isStale()) return
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
    const total = countTasks(project.tasks, false, ctx.plugin.settings.statuses)
    const done = countTasks(project.tasks, true, ctx.plugin.settings.statuses)
    new ProjectCard(grid, {
      title: project.title,
      icon: project.icon,
      color: project.color,
      tasksDone: done,
      tasksTotal: total,
      onClick: safeAsync(async () => {
        const file = ctx.plugin.app.vault.getAbstractFileByPath(project.filePath)
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

function openProjectContextMenu(ctx: ProjectListContext, project: Project, e: MouseEvent): void {
  const menu = new Menu()
  menu.addItem((item) =>
    item
      .setTitle('Edit project')
      .setIcon('settings')
      .onClick(() => {
        openProjectModal(ctx.plugin, {
          project,
          onSave: async () => {
            await renderProjectListContent(ctx)
          }
        })
      })
  )
  menu.addItem((item) =>
    item
      .setTitle('Delete project')
      .setIcon('trash')
      .onClick(
        safeAsync(async () => {
          await ctx.plugin.store.deleteProject(project)
          await renderProjectListContent(ctx)
        })
      )
  )
  menu.showAtMouseEvent(e)
}

function countTasks(tasks: Task[], doneOnly: boolean, statuses: StatusConfig[]): number {
  let n = 0
  for (const t of tasks) {
    if (!doneOnly || isTerminalStatus(t.status, statuses)) n++
    n += countTasks(t.subtasks, doneOnly, statuses)
  }
  return n
}

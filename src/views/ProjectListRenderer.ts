import { ButtonComponent, TFile, Menu } from 'obsidian'
import type PMPlugin from '../main'
import type { Task, StatusConfig } from '../types'
import { safeAsync, isTerminalStatus } from '../utils'
import { openProjectModal } from '../ui/ModalFactory'
import { ProgressBar } from '../ui/primitives/ProgressBar'

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
    .onClick(() => {
      openProjectModal(ctx.plugin, {
        onSave: async (project) => {
          const file = ctx.plugin.app.vault.getAbstractFileByPath(project.filePath)
          if (file instanceof TFile) await ctx.openProjectFile(file)
        }
      })
    })
}

export async function renderProjectListContent(ctx: ProjectListContext): Promise<void> {
  const projects = await ctx.plugin.store.loadAllProjects(ctx.plugin.settings.projectsFolder)
  // Abort if a project view has taken over since this async load started
  if (ctx.isStale()) return
  ctx.contentEl.empty()

  if (projects.length === 0) {
    const empty = ctx.contentEl.createDiv('pm-empty-state')
    empty.createEl('div', { text: '\ud83d\udccb', cls: 'pm-empty-icon' })
    empty.createEl('h3', { text: 'No projects yet' })
    empty.createEl('p', { text: 'Create your first project to get started.' })
    new ButtonComponent(empty)
      .setButtonText('+ new project')
      .setCta()
      .onClick(() => {
        openProjectModal(ctx.plugin, {
          onSave: async (project) => {
            const file = ctx.plugin.app.vault.getAbstractFileByPath(project.filePath)
            if (file instanceof TFile) await ctx.openProjectFile(file)
          }
        })
      })
    return
  }

  const grid = ctx.contentEl.createDiv('pm-project-grid')
  for (const project of projects) {
    const card = grid.createDiv('pm-project-card')
    card.style.setProperty('--pm-project-color', project.color)

    const colorBar = card.createDiv('pm-project-card-bar')
    colorBar.style.background = project.color

    const body = card.createDiv('pm-project-card-body')
    body.createEl('div', { text: project.icon, cls: 'pm-project-card-icon' })
    body.createEl('h3', { text: project.title, cls: 'pm-project-card-title' })

    const meta = body.createDiv('pm-project-card-meta')
    const total = countTasks(project.tasks, false, ctx.plugin.settings.statuses)
    const done = countTasks(project.tasks, true, ctx.plugin.settings.statuses)
    meta.createEl('span', { text: `${done}/${total} tasks`, cls: 'pm-project-card-tasks' })

    new ProgressBar(body)
      .setSize('sm')
      .setValue(total ? (done / total) * 100 : 0)
      .setColor(project.color)

    card.addEventListener(
      'click',
      safeAsync(async () => {
        const file = ctx.plugin.app.vault.getAbstractFileByPath(project.filePath)
        if (file instanceof TFile) await ctx.openProjectFile(file)
      })
    )

    // Context menu
    card.addEventListener('contextmenu', (e: MouseEvent) => {
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
    })
  }
}

function countTasks(tasks: Task[], doneOnly: boolean, statuses: StatusConfig[]): number {
  let n = 0
  for (const t of tasks) {
    if (!doneOnly || isTerminalStatus(t.status, statuses)) n++
    n += countTasks(t.subtasks, doneOnly, statuses)
  }
  return n
}

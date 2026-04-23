import { ItemView, WorkspaceLeaf, TFile } from 'obsidian'
import type PMPlugin from '../main'
import { renderProjectListToolbar, renderProjectListContent } from './ProjectListRenderer'
import type { ProjectListContext } from './ProjectListRenderer'

export const PM_DASHBOARD_VIEW_TYPE = 'pm-dashboard'

export class DashboardView extends ItemView {
  private plugin: PMPlugin
  private toolbarEl!: HTMLElement
  private bodyEl!: HTMLElement
  private renderToken = 0

  constructor(leaf: WorkspaceLeaf, plugin: PMPlugin) {
    super(leaf)
    this.plugin = plugin
    this.navigation = false
  }

  getViewType(): string {
    return PM_DASHBOARD_VIEW_TYPE
  }
  getDisplayText(): string {
    return 'Projects'
  }
  getIcon(): string {
    return 'chart-gantt'
  }

  onOpen(): Promise<void> {
    this.containerEl.addClass('pm-view')
    const root = this.contentEl
    root.empty()
    root.addClass('pm-root')
    this.toolbarEl = root.createDiv('pm-toolbar')
    this.bodyEl = root.createDiv('pm-content')
    this.render()
    return Promise.resolve()
  }

  render(): void {
    const ctx = this.makeCtx()
    renderProjectListToolbar(ctx)
    this.bodyEl.empty()
    this.bodyEl.addClass('pm-project-list-container')
    void renderProjectListContent(ctx)
  }

  private makeCtx(): ProjectListContext {
    const token = ++this.renderToken
    return {
      plugin: this.plugin,
      toolbarEl: this.toolbarEl,
      contentEl: this.bodyEl,
      isStale: () => token !== this.renderToken,
      openProjectFile: (file: TFile) => this.plugin.router.openProject(file)
    }
  }
}

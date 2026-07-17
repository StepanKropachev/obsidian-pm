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
  private reloadDebounceTimer: number | null = null

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
    this.registerVaultListeners()
    return Promise.resolve()
  }

  onClose(): Promise<void> {
    if (this.reloadDebounceTimer !== null) {
      window.clearTimeout(this.reloadDebounceTimer)
      this.reloadDebounceTimer = null
    }
    return Promise.resolve()
  }

  private registerVaultListeners(): void {
    // Route the refresh guard through the store's vault-wide predicate so a
    // `pm-project: true` file (or task file) created/renamed/deleted anywhere —
    // not only under the global projects folder — live-refreshes the dashboard,
    // matching discovery's vault-wide reach (INT-014 amendment 2, R28).
    const isRelevant = (path: string) => this.plugin.store.isProjectRelevantPath(path)
    const scheduleReload = (path: string) => {
      if (!isRelevant(path)) return
      if (this.reloadDebounceTimer !== null) window.clearTimeout(this.reloadDebounceTimer)
      this.reloadDebounceTimer = window.setTimeout(() => {
        this.reloadDebounceTimer = null
        this.render()
      }, 300)
    }
    this.registerEvent(this.app.vault.on('create', (file) => scheduleReload(file.path)))
    this.registerEvent(this.app.vault.on('modify', (file) => scheduleReload(file.path)))
    this.registerEvent(this.app.vault.on('delete', (file) => scheduleReload(file.path)))
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        scheduleReload(file.path)
        scheduleReload(oldPath)
      })
    )
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

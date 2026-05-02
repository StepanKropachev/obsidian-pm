import { ButtonComponent, ExtraButtonComponent, ItemView, WorkspaceLeaf, TFile, EventRef } from 'obsidian'
import type PMPlugin from '../main'
import { Project, ViewMode, FilterState, SavedView, makeDefaultFilter, makeId } from '../types'
import { truncateTitle, safeAsync } from '../utils'
import type { SubView } from './SubView'
import { TableView } from './table/TableView'
import type { TableViewState } from './table/TableView'
import { GanttView } from './gantt/GanttView'
import { KanbanView } from './KanbanView'
import { openProjectModal, openTaskModal } from '../ui/ModalFactory'
import { ViewSwitcher } from '../ui/primitives/ViewSwitcher'
import { ProjectHeader } from '../ui/composites/ProjectHeader'

export const PM_PROJECT_VIEW_TYPE = 'pm-project'

interface ProjectViewState {
  filePath: string
  [key: string]: unknown
}

export class ProjectView extends ItemView {
  plugin: PMPlugin
  project: Project | null = null
  filePath = ''
  currentView: ViewMode
  filter: FilterState = makeDefaultFilter()
  activeSavedViewId: string | null = null
  private subview: SubView | null = null
  private savedTableViewState: TableViewState | null = null
  private toolbarEl!: HTMLElement
  private headerEl!: HTMLElement
  private bodyEl!: HTMLElement
  private header: ProjectHeader | null = null
  private titleEl2!: HTMLElement
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null
  private fileModifyRef: EventRef | null = null
  private reloadDebounceTimer: number | null = null

  constructor(leaf: WorkspaceLeaf, plugin: PMPlugin) {
    super(leaf)
    this.plugin = plugin
    this.currentView = plugin.settings.defaultView
    this.navigation = false
  }

  getViewType(): string {
    return PM_PROJECT_VIEW_TYPE
  }
  getDisplayText(): string {
    return truncateTitle(this.project?.title ?? 'Project', 10)
  }
  getIcon(): string {
    return 'chart-gantt'
  }

  async setState(state: ProjectViewState, result: unknown): Promise<void> {
    if (state.filePath && state.filePath !== this.filePath) {
      this.filePath = state.filePath
      await this.loadProject()
    }
    await super.setState(state, result as import('obsidian').ViewStateResult)
  }

  getState(): ProjectViewState {
    return { filePath: this.filePath }
  }

  async onOpen(): Promise<void> {
    this.containerEl.addClass('pm-view')
    const root = this.contentEl
    root.empty()
    root.addClass('pm-root')
    this.toolbarEl = root.createDiv('pm-toolbar')
    this.headerEl = root.createDiv('pm-project-header-mount')
    this.bodyEl = root.createDiv('pm-content')

    if (this.filePath) await this.loadProject()

    this.keydownHandler = (e: KeyboardEvent) => {
      this.subview?.handleKeyDown?.(e)
    }
    this.containerEl.addEventListener('keydown', this.keydownHandler)
    if (!this.containerEl.hasAttribute('tabindex')) {
      this.containerEl.setAttribute('tabindex', '-1')
    }

    const reloadIfRelevant = (filePath: string) => {
      if (!this.project || !this.filePath) return false
      const taskFolder = this.filePath.replace(/\.md$/, '_tasks')
      return filePath.startsWith(taskFolder) || filePath === this.filePath
    }
    this.fileModifyRef = this.app.vault.on('modify', (file) => {
      if (!(file instanceof TFile) || !reloadIfRelevant(file.path)) return
      if (this.reloadDebounceTimer !== null) activeWindow.clearTimeout(this.reloadDebounceTimer)
      this.reloadDebounceTimer = activeWindow.setTimeout(
        safeAsync(async () => {
          this.reloadDebounceTimer = null
          await this.loadProject()
        }),
        300
      )
    })
    this.registerEvent(this.fileModifyRef)
    this.registerEvent(
      this.app.vault.on(
        'delete',
        safeAsync(async (file) => {
          if (reloadIfRelevant(file.path)) {
            await this.loadProject()
          }
        })
      )
    )
  }

  onClose(): Promise<void> {
    if (this.reloadDebounceTimer !== null) {
      activeWindow.clearTimeout(this.reloadDebounceTimer)
      this.reloadDebounceTimer = null
    }
    if (this.keydownHandler) {
      this.containerEl.removeEventListener('keydown', this.keydownHandler)
      this.keydownHandler = null
    }
    this.fileModifyRef = null
    this.subview?.destroy?.()
    this.subview = null
    return Promise.resolve()
  }

  private async loadProject(): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(this.filePath)
    if (!(file instanceof TFile)) {
      this.renderMissingProject()
      return
    }
    this.project = await this.plugin.store.loadProject(file)
    if (!this.project) {
      this.renderMissingProject()
      return
    }
    this.loadFilterFromSettings()
    ;(this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.()
    this.renderProjectToolbar()
    this.renderProjectHeader()
    this.renderCurrentView()
  }

  private loadFilterFromSettings(): void {
    const saved = this.plugin.settings.projectFilters[this.filePath]
    if (saved) {
      this.filter = saved.filter
      this.activeSavedViewId = saved.activeSavedViewId
    } else {
      this.filter = makeDefaultFilter()
      this.activeSavedViewId = null
    }
  }

  private async persistFilter(): Promise<void> {
    if (!this.filePath) return
    this.plugin.settings.projectFilters[this.filePath] = {
      filter: this.filter,
      activeSavedViewId: this.activeSavedViewId
    }
    await this.plugin.saveSettings()
  }

  private renderMissingProject(): void {
    this.toolbarEl.empty()
    this.headerEl.empty()
    this.header = null
    this.bodyEl.empty()
    const msg = this.bodyEl.createDiv('pm-empty-state')
    msg.createEl('h3', { text: 'Project not found' })
    msg.createEl('p', { text: `No project at ${this.filePath}. It may have been deleted or renamed.` })
  }

  private renderProjectHeader(): void {
    if (!this.project) return
    this.headerEl.empty()
    this.header = new ProjectHeader(this.headerEl, {
      project: this.project,
      statuses: this.plugin.settings.statuses,
      priorities: this.plugin.settings.priorities,
      filter: this.filter,
      activeSavedViewId: this.activeSavedViewId,
      onFilterChange: () => this.handleFilterMutation(),
      onClearFilter: () => this.handleClearFilter(),
      onSavedViewSelect: (id) => this.handleSavedViewSelect(id),
      onSavedViewSave: (name) => this.handleSavedViewSave(name),
      onSavedViewUpdate: (id) => this.handleSavedViewUpdate(id),
      onSavedViewDelete: (id) => this.handleSavedViewDelete(id)
    })
  }

  private handleFilterMutation(): void {
    if (this.activeSavedViewId !== null) {
      this.activeSavedViewId = null
      this.header?.setActiveSavedViewId(null)
    } else {
      this.header?.notifyMutation()
    }
    void this.persistFilter()
    this.refreshSubview()
  }

  private handleClearFilter(): void {
    Object.assign(this.filter, makeDefaultFilter())
    this.activeSavedViewId = null
    void this.persistFilter()
    this.header?.refresh()
    this.refreshSubview()
  }

  private handleSavedViewSelect(id: string | null): void {
    if (!this.project) return
    if (id === null) {
      Object.assign(this.filter, makeDefaultFilter())
      this.activeSavedViewId = null
    } else {
      const sv = this.project.savedViews.find((v) => v.id === id)
      if (!sv) return
      Object.assign(this.filter, sv.filter)
      this.activeSavedViewId = sv.id
      if (sv.viewMode && sv.viewMode !== this.currentView) {
        this.currentView = sv.viewMode
        this.renderProjectToolbar()
      }
      if (this.subview instanceof TableView) {
        this.savedTableViewState = { sortKey: sv.sortKey as TableViewState['sortKey'], sortDir: sv.sortDir }
      }
    }
    void this.persistFilter()
    this.header?.refresh()
    this.renderCurrentView()
  }

  private async handleSavedViewSave(name: string): Promise<void> {
    if (!this.project) return
    const sortMeta =
      this.subview instanceof TableView ? this.subview.getViewState() : { sortKey: 'status', sortDir: 'asc' as const }
    const sv: SavedView = {
      id: makeId(),
      name,
      filter: { ...this.filter },
      sortKey: sortMeta.sortKey,
      sortDir: sortMeta.sortDir,
      viewMode: this.currentView
    }
    this.project.savedViews.push(sv)
    this.activeSavedViewId = sv.id
    await this.plugin.store.saveProject(this.project)
    void this.persistFilter()
    this.header?.refresh()
  }

  private async handleSavedViewUpdate(id: string): Promise<void> {
    if (!this.project) return
    const sv = this.project.savedViews.find((v) => v.id === id)
    if (!sv) return
    sv.filter = { ...this.filter }
    sv.viewMode = this.currentView
    if (this.subview instanceof TableView) {
      const ts = this.subview.getViewState()
      sv.sortKey = ts.sortKey
      sv.sortDir = ts.sortDir
    }
    await this.plugin.store.saveProject(this.project)
    this.header?.refresh()
  }

  private async handleSavedViewDelete(id: string): Promise<void> {
    if (!this.project) return
    this.project.savedViews = this.project.savedViews.filter((v) => v.id !== id)
    if (this.activeSavedViewId === id) this.activeSavedViewId = null
    await this.plugin.store.saveProject(this.project)
    void this.persistFilter()
    this.header?.refresh()
  }

  private refreshSubview(): void {
    this.subview?.render()
  }

  private renderProjectToolbar(): void {
    if (!this.project) return
    this.toolbarEl.empty()

    const left = this.toolbarEl.createDiv('pm-toolbar-left')
    const iconEl = left.createEl('span', {
      text: this.project.icon,
      cls: 'pm-toolbar-icon',
      attr: { 'aria-label': 'Edit project', role: 'button', tabindex: '0' }
    })
    iconEl.addEventListener('click', () => {
      openProjectModal(this.plugin, {
        project: this.project,
        onSave: (updated) => {
          this.project = updated
          this.renderProjectToolbar()
        }
      })
    })

    this.titleEl2 = left.createEl('h2', { text: this.project.title, cls: 'pm-toolbar-title' })
    this.titleEl2.contentEditable = 'true'
    this.titleEl2.addEventListener(
      'blur',
      safeAsync(async () => {
        if (!this.project) return
        this.project.title = this.titleEl2.textContent?.trim() ?? this.project.title
        await this.plugin.store.saveProject(this.project)
      })
    )

    new ViewSwitcher<ViewMode>(this.toolbarEl, {
      options: [
        { id: 'table', icon: '≡', label: 'Table' },
        { id: 'gantt', icon: '▬', label: 'Gantt' },
        { id: 'kanban', icon: '⊞', label: 'Board' }
      ],
      active: this.currentView,
      onChange: (mode) => {
        this.currentView = mode
        this.renderCurrentView()
      }
    })

    const right = this.toolbarEl.createDiv('pm-toolbar-right')
    new ButtonComponent(right)
      .setButtonText('+ add task')
      .setCta()
      .onClick(() => {
        if (!this.project) return
        openTaskModal(this.plugin, this.project, {
          onSave: async () => {
            await this.refreshProject()
          }
        })
      })

    if (this.currentView === 'gantt') {
      new ButtonComponent(right).setButtonText('+ milestone').onClick(() => {
        if (!this.project) return
        openTaskModal(this.plugin, this.project, {
          defaults: { type: 'milestone' },
          onSave: async () => {
            await this.refreshProject()
          }
        })
      })
    }

    new ExtraButtonComponent(right)
      .setIcon('settings')
      .setTooltip('Project settings')
      .onClick(() => {
        openProjectModal(this.plugin, {
          project: this.project,
          onSave: (updated) => {
            this.project = updated
            this.renderProjectToolbar()
            this.renderCurrentView()
          }
        })
      })
  }

  private renderCurrentView(): void {
    if (!this.project) return

    let savedGanttScroll: ReturnType<GanttView['getScrollPosition']> | null = null
    let savedGanttLabelWidth: number | null = null
    if (this.currentView === 'gantt' && this.subview instanceof GanttView) {
      savedGanttScroll = this.subview.getScrollPosition()
      savedGanttLabelWidth = this.subview.getLabelWidth()
    }

    let savedTableScrollTop: number | null = null
    if (this.subview instanceof TableView) {
      this.savedTableViewState = this.subview.getViewState()
      if (this.currentView === 'table') {
        savedTableScrollTop = this.subview.getScrollTop()
      }
    } else if (this.currentView !== 'table') {
      this.savedTableViewState = null
    }

    this.subview?.destroy?.()
    this.bodyEl.empty()
    this.subview = null

    switch (this.currentView) {
      case 'table': {
        const table = new TableView(
          this.bodyEl,
          this.project,
          this.plugin,
          () => this.refreshProject(),
          this.filter,
          this.savedTableViewState ?? undefined
        )
        if (savedTableScrollTop !== null) table.setPendingScrollTop(savedTableScrollTop)
        this.subview = table
        break
      }
      case 'gantt': {
        const gantt = new GanttView(this.bodyEl, this.project, this.plugin, () => this.refreshProject(), this.filter)
        if (savedGanttScroll) gantt.setPendingScroll(savedGanttScroll)
        if (savedGanttLabelWidth !== null) gantt.setLabelWidth(savedGanttLabelWidth)
        this.subview = gantt
        break
      }
      case 'kanban':
        this.subview = new KanbanView(this.bodyEl, this.project, this.plugin, () => this.refreshProject(), this.filter)
        break
    }
    this.subview?.render()
  }

  async refreshProject(): Promise<void> {
    if (!this.filePath) return
    if (this.reloadDebounceTimer !== null) {
      activeWindow.clearTimeout(this.reloadDebounceTimer)
      this.reloadDebounceTimer = null
    }
    const file = this.app.vault.getAbstractFileByPath(this.filePath)
    if (file instanceof TFile) {
      this.project = await this.plugin.store.loadProject(file)
    }
    this.renderCurrentView()
  }
}

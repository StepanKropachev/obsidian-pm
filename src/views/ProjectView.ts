import { ButtonComponent, ExtraButtonComponent, ItemView, Menu, WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '../main'
import { type Project, type ViewMode, type FilterState, type SavedView, makeDefaultFilter, makeId } from '../types'
import { ProjectScope, resolveScopePaths, scopeKey, type ScopeSpec } from '../store'
import { truncateTitle, safeAsync } from '../utils'
import type { SubView } from './SubView'
import { TableView } from './table/TableView'
import type { TableViewState } from './table/TableView'
import { GanttView } from './gantt/GanttView'
import { KanbanView } from './KanbanView'
import { openTaskModal } from '../ui/ModalFactory'
import { ChipButton } from '../ui/primitives/ChipButton'
import { ViewSwitcher } from '../ui/primitives/ViewSwitcher'
import { ProjectHeader } from '../ui/composites/ProjectHeader'

export const PM_PROJECT_VIEW_TYPE = 'pm-project'

interface ProjectViewState {
  scope?: ScopeSpec
  /** How a project view was addressed before scopes; still accepted from saved layouts. */
  filePath?: string
  [key: string]: unknown
}

function specOf(state: ProjectViewState): ScopeSpec | null {
  if (state.scope) return state.scope
  if (state.filePath) return { kind: 'project', path: state.filePath }
  return null
}

export class ProjectView extends ItemView {
  plugin: PMPlugin
  projectScope: ProjectScope | null = null
  private spec: ScopeSpec | null = null
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
  private pendingRefresh: Promise<void> | null = null
  private initialized = false
  /** Set once the default view mode is applied, so reloads don't undo a mode switch. */
  private defaultViewAppliedFor: string | null = null
  /**
   * The paths the current load covers, claimed before it starts. Loading a project can
   * write to it, and that write comes back as an index change, so comparing against the
   * projects already in hand would reload on top of a load that has not finished.
   */
  private loadedPaths: string[] = []

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
    return truncateTitle(this.projectScope?.label() ?? 'Project', 10)
  }
  getIcon(): string {
    return 'chart-gantt'
  }

  /** The project a command should act on: the only one, or the group's primary. */
  get project(): Project | null {
    return this.projectScope?.primary ?? null
  }

  async setState(state: ProjectViewState, result: unknown): Promise<void> {
    const spec = specOf(state)
    if (spec && (!this.spec || scopeKey(this.spec) !== scopeKey(spec))) {
      this.spec = spec
      await this.loadScope()
    }
    await super.setState(state, result as import('obsidian').ViewStateResult)
  }

  getState(): ProjectViewState {
    return { scope: this.spec ?? undefined, filePath: this.projectScope?.primary?.filePath }
  }

  onOpen(): Promise<void> {
    // Setup only. setState is the sole loader; this just guarantees the scaffold and
    // listeners exist for hosts that open the view without it.
    this.ensureInitialized()
    return Promise.resolve()
  }

  onClose(): Promise<void> {
    if (this.keydownHandler) {
      this.containerEl.removeEventListener('keydown', this.keydownHandler)
      this.keydownHandler = null
    }
    this.subview?.destroy?.()
    this.subview = null
    return Promise.resolve()
  }

  // Pane Relief and Hover Editor restore a deferred leaf via setState without ever
  // calling onOpen, so the one-time setup runs from whichever fires first.
  private ensureInitialized(): void {
    if (this.initialized) return
    this.initialized = true

    this.containerEl.addClass('pm-view')
    const root = this.contentEl
    root.empty()
    root.addClass('pm-root')
    this.toolbarEl = root.createDiv('pm-toolbar')
    this.headerEl = root.createDiv('pm-project-header-mount')
    this.bodyEl = root.createDiv('pm-content')

    this.keydownHandler = (e: KeyboardEvent) => {
      this.subview?.handleKeyDown?.(e)
    }
    this.containerEl.addEventListener('keydown', this.keydownHandler)
    if (!this.containerEl.hasAttribute('tabindex')) {
      this.containerEl.setAttribute('tabindex', '-1')
    }

    this.register(
      this.plugin.store.onProjectChanged((path) => {
        if (this.projectScope?.projects.some((project) => project.filePath === path)) this.redraw()
      })
    )
    // A scope changes when a project joins or leaves it, which for a single-project scope
    // includes the project appearing once the index has caught up with the vault.
    this.register(
      this.plugin.index.onChange(() => {
        if (!this.spec) return
        const paths = resolveScopePaths(this.spec, this.plugin.index)
        const current = this.loadedPaths
        if (paths.length !== current.length || paths.some((path, i) => path !== current[i])) {
          void this.loadScope()
        }
      })
    )
  }

  /**
   * Something outside the DOM changed: a project in scope, or a setting that decides how
   * it is drawn. The store keeps one instance per file, so the projects are already
   * current and only the DOM needs catching up.
   */
  redraw(): void {
    if (!this.projectScope || !this.spec) return
    if (!this.projectScope.primary) {
      this.renderEmptyScope()
      return
    }
    // A settings edit may have changed a palette, which the scope has resolved and kept.
    this.projectScope.invalidate()
    // Rebuilding the chrome would drop the caret out of the title or search box.
    const focused = activeDocument.activeElement
    if (!this.toolbarEl.contains(focused) && !this.headerEl.contains(focused)) {
      this.renderProjectToolbar()
      this.renderProjectHeader()
    }
    void this.refreshProject()
  }

  private async loadScope(): Promise<void> {
    this.ensureInitialized()
    if (!this.spec) return
    const paths = resolveScopePaths(this.spec, this.plugin.index)
    this.loadedPaths = paths
    const projects = await this.plugin.store.loadProjects(paths)
    this.projectScope = new ProjectScope(this.spec, projects, this.plugin.store)
    if (!this.projectScope.primary) {
      this.renderEmptyScope()
      return
    }
    for (const project of projects) this.plugin.applyCollapsedState(project)
    if (this.defaultViewAppliedFor !== this.projectScope.key) {
      this.defaultViewAppliedFor = this.projectScope.key
      this.currentView = this.projectScope.config.defaultView
    }
    this.loadFilterFromSettings()
    ;(this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.()
    this.renderProjectToolbar()
    this.renderProjectHeader()
    this.renderCurrentView()
  }

  private async switchScope(spec: ScopeSpec): Promise<void> {
    this.spec = spec
    await this.loadScope()
    await this.leaf.setViewState({ type: PM_PROJECT_VIEW_TYPE, state: this.getState() })
  }

  private loadFilterFromSettings(): void {
    const saved = this.projectScope ? this.plugin.settings.projectFilters[this.projectScope.key] : undefined
    if (saved) {
      this.filter = saved.filter
      this.activeSavedViewId = saved.activeSavedViewId
    } else {
      this.filter = makeDefaultFilter()
      this.activeSavedViewId = null
    }
  }

  private async persistFilter(): Promise<void> {
    if (!this.projectScope) return
    this.plugin.settings.projectFilters[this.projectScope.key] = {
      filter: this.filter,
      activeSavedViewId: this.activeSavedViewId
    }
    await this.plugin.saveSettings()
  }

  /** One project owns its saved views; a group of them has no file to keep them in. */
  private savedViews(): SavedView[] {
    if (!this.projectScope) return []
    if (this.projectScope.spec.kind === 'project') return this.projectScope.primary?.savedViews ?? []
    return this.plugin.settings.scopeViews[this.projectScope.key] ?? []
  }

  private async persistSavedViews(views: SavedView[]): Promise<void> {
    if (!this.projectScope) return
    const primary = this.projectScope.primary
    if (this.projectScope.spec.kind === 'project' && primary) {
      primary.savedViews = views
      await this.plugin.store.saveProject(primary)
      return
    }
    this.plugin.settings.scopeViews[this.projectScope.key] = views
    await this.plugin.saveSettings()
  }

  private renderEmptyScope(): void {
    this.toolbarEl.empty()
    this.headerEl.empty()
    this.header = null
    this.bodyEl.empty()
    const msg = this.bodyEl.createDiv('pm-empty-state')
    msg.createEl('h3', { text: 'Nothing to show' })
    msg.createEl('p', { text: 'No project here. It may have been deleted or renamed.' })
  }

  private renderProjectHeader(): void {
    if (!this.projectScope?.primary) return
    this.headerEl.empty()
    const config = this.projectScope.config
    this.header = new ProjectHeader(this.headerEl, {
      tasks: this.projectScope.tasks(),
      savedViews: this.savedViews(),
      statuses: config.statuses,
      priorities: config.priorities,
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
    if (!this.projectScope) return
    if (id === null) {
      Object.assign(this.filter, makeDefaultFilter())
      this.activeSavedViewId = null
    } else {
      const sv = this.savedViews().find((v) => v.id === id)
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
    if (!this.projectScope) return
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
    this.activeSavedViewId = sv.id
    await this.persistSavedViews([...this.savedViews(), sv])
    void this.persistFilter()
    this.renderProjectHeader()
  }

  private async handleSavedViewUpdate(id: string): Promise<void> {
    const views = this.savedViews()
    const sv = views.find((v) => v.id === id)
    if (!sv) return
    sv.filter = { ...this.filter }
    sv.viewMode = this.currentView
    if (this.subview instanceof TableView) {
      const ts = this.subview.getViewState()
      sv.sortKey = ts.sortKey
      sv.sortDir = ts.sortDir
    }
    await this.persistSavedViews(views)
    this.header?.refresh()
  }

  private async handleSavedViewDelete(id: string): Promise<void> {
    if (this.activeSavedViewId === id) this.activeSavedViewId = null
    await this.persistSavedViews(this.savedViews().filter((v) => v.id !== id))
    void this.persistFilter()
    this.renderProjectHeader()
  }

  private refreshSubview(): void {
    this.subview?.render()
  }

  private renderProjectToolbar(): void {
    const scope = this.projectScope
    const primary = scope?.primary
    if (!scope || !primary) return
    this.toolbarEl.empty()

    const left = this.toolbarEl.createDiv('pm-toolbar-left')
    if (!scope.isMulti) {
      const iconEl = left.createSpan({
        text: primary.icon,
        cls: 'pm-toolbar-icon',
        attr: { 'aria-label': 'Open project page', role: 'button', tabindex: '0' }
      })
      iconEl.addEventListener(
        'click',
        safeAsync(() => this.plugin.router.openProjectOverview(primary.filePath))
      )
    }

    this.titleEl2 = left.createEl('h2', { text: scope.label(), cls: 'pm-toolbar-title' })
    if (!scope.isMulti) {
      this.titleEl2.contentEditable = 'true'
      this.titleEl2.addEventListener(
        'blur',
        safeAsync(async () => {
          const title = this.titleEl2.textContent?.trim()
          if (!title || title === primary.title) return
          await this.plugin.store.updateProject(primary, { title })
        })
      )
    }
    this.renderScopeSwitcher(left)

    new ViewSwitcher<ViewMode>(this.toolbarEl, {
      options: [
        { id: 'table', icon: 'table', label: 'Table' },
        { id: 'gantt', icon: 'git-fork', label: 'Gantt' },
        { id: 'kanban', icon: 'layout-dashboard', label: 'Board' }
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
      .onClick((e) => this.addTask(e))

    if (this.currentView === 'gantt') {
      new ButtonComponent(right).setButtonText('+ milestone').onClick((e) => this.addTask(e, { type: 'milestone' }))
    }

    if (!scope.isMulti) {
      new ExtraButtonComponent(right)
        .setIcon('settings')
        .setTooltip('Project settings')
        .onClick(safeAsync(() => this.plugin.router.openProjectEdit(primary.filePath)))
    }
  }

  /** With several projects in view, a new task has to say which one it belongs to. */
  private addTask(e: MouseEvent, defaults?: Parameters<typeof openTaskModal>[2]['defaults']): void {
    const scope = this.projectScope
    if (!scope?.primary) return
    const open = (project: Project): void => {
      openTaskModal(this.plugin, project, {
        defaults,
        onSave: async () => {
          await this.refreshProject()
        }
      })
    }
    if (!scope.isMulti) {
      open(scope.primary)
      return
    }
    const menu = new Menu()
    for (const project of scope.projects) {
      menu.addItem((item) =>
        item
          .setTitle(project.title)
          .setIcon('plus')
          .onClick(() => open(project))
      )
    }
    menu.showAtMouseEvent(e)
  }

  private renderScopeSwitcher(parent: HTMLElement): void {
    const scope = this.projectScope
    const primary = scope?.primary
    if (!scope || !primary) return
    const path = scope.spec.kind === 'vault' ? primary.filePath : scope.spec.path
    const projectPath = scope.spec.kind === 'project' || scope.spec.kind === 'subtree' ? path : primary.filePath
    const folder = projectPath.slice(0, projectPath.lastIndexOf('/'))

    const options: { label: string; spec: ScopeSpec }[] = [
      { label: 'This project', spec: { kind: 'project', path: projectPath } },
      { label: 'With sub-projects', spec: { kind: 'subtree', path: projectPath } },
      { label: folder ? `Folder: ${folder}` : 'Vault folder', spec: { kind: 'folder', path: folder } },
      { label: 'All projects', spec: { kind: 'vault' } }
    ]
    const current = options.find((option) => scope.key === scopeKey(option.spec))

    new ChipButton(parent)
      .setLabel(current?.label ?? 'This project')
      .setShape('pill')
      .setAriaLabel('Change which projects this view shows')
      .onClick((e) => {
        const menu = new Menu()
        for (const option of options) {
          menu.addItem((item) =>
            item
              .setTitle(option.label)
              .setChecked(scope.key === scopeKey(option.spec))
              .onClick(safeAsync(() => this.switchScope(option.spec)))
          )
        }
        menu.showAtMouseEvent(e)
      })
  }

  private renderCurrentView(): void {
    const scope = this.projectScope
    if (!scope?.primary) return

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
          scope,
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
        const gantt = new GanttView(this.bodyEl, scope, this.plugin, () => this.refreshProject(), this.filter)
        if (savedGanttScroll) gantt.setPendingScroll(savedGanttScroll)
        if (savedGanttLabelWidth !== null) gantt.setLabelWidth(savedGanttLabelWidth)
        this.subview = gantt
        break
      }
      case 'kanban':
        this.subview = new KanbanView(this.bodyEl, scope, this.plugin, () => this.refreshProject(), this.filter)
        break
    }
    this.bodyEl.toggleClass('pm-content--kanban', this.currentView === 'kanban')
    this.subview?.render()
  }

  /**
   * Re-render from the projects in memory. Coalesced, so a mutation reporting back
   * through both its own callback and the store's change event paints once.
   */
  refreshProject(): Promise<void> {
    if (this.pendingRefresh) return this.pendingRefresh
    this.pendingRefresh = new Promise((resolve) => {
      window.setTimeout(() => {
        this.pendingRefresh = null
        if (this.projectScope?.primary) {
          if (this.subview?.refresh) this.subview.refresh()
          else if (this.subview) this.subview.render()
          else this.renderCurrentView()
        }
        resolve()
      }, 0)
    })
    return this.pendingRefresh
  }
}

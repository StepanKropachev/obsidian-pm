import { MarkdownView, Plugin, Notice, TFile } from 'obsidian'
import { DEFAULT_SETTINGS, makeDefaultFilter, type PMSettings, type Project, type Task } from './types'
import { flattenTasks, findTask } from './store/TaskTreeOps'
import { matchPersonNotes, personLink, ProjectStore, scopeKey, VaultIndex } from './store'
import type { ProjectRef, TaskSource } from './store'
import { PMSettingTab } from './settings'
import { ProjectView, PM_PROJECT_VIEW_TYPE } from './views/ProjectView'
import { ProjectOverviewView, PM_PROJECT_OVERVIEW_VIEW_TYPE } from './views/ProjectOverviewView'
import { ProjectEditView, PM_PROJECT_EDIT_VIEW_TYPE } from './views/ProjectEditView'
import { DashboardView, PM_DASHBOARD_VIEW_TYPE } from './views/DashboardView'
import { TaskView, PM_TASK_VIEW_TYPE } from './views/TaskView'
import { registerStyleguide } from './views/styleguide/StyleguideView'
import { PMViewRouter } from './views/PMViewRouter'
import {
  openTaskModal,
  openProjectCreate,
  openPersonPicker,
  openProjectPicker,
  openTaskPicker,
  openImportModal,
  confirmDialog
} from './ui/ModalFactory'
import { Notifier } from './components/Notifier'
import { migrateProjects } from './migration'
import { dedupePeople, displayName, safeAsync } from './utils'

export default class PMPlugin extends Plugin {
  settings: PMSettings = { ...DEFAULT_SETTINGS }
  store!: TaskSource
  index!: VaultIndex
  notifier!: Notifier
  router!: PMViewRouter
  /** Paths deliberately sent to the markdown editor, which the swap then leaves alone. */
  private markdownEscapes = new Set<string>()
  private viewRefreshScheduled = false
  undoStack: Array<{ undo: () => Promise<void>; redo: () => Promise<void> }> = []
  redoStack: Array<{ undo: () => Promise<void>; redo: () => Promise<void> }> = []

  pushUndo(entry: { undo: () => Promise<void>; redo: () => Promise<void> }): void {
    this.undoStack.push(entry)
    if (this.undoStack.length > 20) this.undoStack.shift()
    this.redoStack = []
  }

  async undoLastAction(): Promise<void> {
    const entry = this.undoStack.pop()
    if (entry) {
      await entry.undo()
      this.redoStack.push(entry)
    }
  }

  async redoLastAction(): Promise<void> {
    const entry = this.redoStack.pop()
    if (entry) {
      await entry.redo()
      this.undoStack.push(entry)
    }
  }

  async onload(): Promise<void> {
    await this.loadSettings()
    this.index = new VaultIndex(this.app, () => this.settings)
    // The first sweep can run against a half-filled metadata cache, so it runs again once
    // the index has caught up. Everything in it is safe to repeat.
    this.index.register(this, () => {
      void this.startupSweep()
    })
    this.store = new ProjectStore(this.app, () => this.settings, this.index)
    this.store.registerVaultSync(this)
    this.notifier = new Notifier(this)
    this.router = new PMViewRouter(this)

    this.registerView(PM_PROJECT_VIEW_TYPE, (leaf) => new ProjectView(leaf, this))
    this.registerView(PM_PROJECT_OVERVIEW_VIEW_TYPE, (leaf) => new ProjectOverviewView(leaf, this))
    this.registerView(PM_PROJECT_EDIT_VIEW_TYPE, (leaf) => new ProjectEditView(leaf, this))
    this.registerView(PM_DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this))
    this.registerView(PM_TASK_VIEW_TYPE, (leaf) => new TaskView(leaf, this))
    this.registerTaskNoteSwap()
    if (__STYLEGUIDE__) registerStyleguide(this)

    this.app.workspace.onLayoutReady(
      safeAsync(async () => {
        this.index.build()
        await this.startupSweep()
      })
    )

    this.addRibbonIcon('chart-gantt', 'Project manager', async () => {
      await this.router.openDashboard()
    })

    this.addCommand({
      id: 'open-projects',
      name: 'Open projects pane',
      callback: () => {
        void this.router.openDashboard()
      }
    })

    this.addCommand({
      id: 'new-project',
      name: 'Create new project',
      callback: () => {
        openProjectCreate(this)
      }
    })

    this.addCommand({
      id: 'new-task',
      name: 'Create new task',
      callback: () => {
        this.pickProjectThenCreateTask(null)
      }
    })

    this.addCommand({
      id: 'new-subtask',
      name: 'Create new subtask',
      callback: () => {
        this.pickProjectThenCreateTask('pick-parent')
      }
    })

    this.addCommand({
      id: 'undo-last-action',
      name: 'Undo last action',
      callback: () => {
        void this.undoLastAction()
      }
    })

    this.addCommand({
      id: 'redo-last-action',
      name: 'Redo last action',
      callback: () => {
        void this.redoLastAction()
      }
    })

    this.addCommand({
      id: 'open-all-projects',
      name: 'Open all projects in one view',
      callback: () => {
        void this.router.openScope({ kind: 'vault' })
      }
    })

    this.addCommand({
      id: 'rebuild-project-index',
      name: 'Rebuild project index',
      callback: () => {
        this.index.build()
        this.showNotice(`Found ${this.index.projectRefs().length} project(s).`)
      }
    })

    this.addCommand({
      id: 'import-notes-as-tasks',
      name: 'Import notes as tasks',
      callback: () => {
        this.importNotes()
      }
    })

    this.addCommand({
      id: 'create-task-from-selection',
      name: 'Create task from selection',
      editorCheckCallback: (checking, editor) => {
        const selection = editor.getSelection().trim()
        if (!selection) return false
        if (checking) return true
        this.createTaskFromText(selection)
        return true
      }
    })

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor) => {
        const selection = editor.getSelection().trim()
        if (!selection) return
        menu.addItem((item) =>
          item
            .setTitle('Create task from selection')
            .setIcon('list-plus')
            .onClick(() => this.createTaskFromText(selection))
        )
      })
    )

    this.addCommand({
      id: 'open-current-as-project',
      name: 'Open current file as project',
      checkCallback: (checking: boolean) => {
        const md = this.app.workspace.getActiveViewOfType(MarkdownView)
        const file = md?.file
        if (!file) return false
        const cache = this.app.metadataCache.getFileCache(file)
        if (cache?.frontmatter?.['pm-project'] !== true) return false
        if (checking) return true
        void this.router.openProjectOverview(file.path, md.leaf)
        return true
      }
    })

    this.addCommand({
      id: 'person-tasks',
      name: 'Show tasks assigned to a person',
      callback: () => {
        openPersonPicker(this, this.index.allAssignees(), '', (value) => this.showTasksForPerson(value))
      }
    })

    this.addCommand({
      id: 'person-tasks-this-note',
      name: 'Show tasks assigned to this note',
      checkCallback: (checking: boolean) => {
        const md = this.app.workspace.getActiveViewOfType(MarkdownView)
        const file = md?.file
        if (!file) return false
        const cache = this.app.metadataCache.getFileCache(file)
        if (cache?.frontmatter?.['pm-task'] === true || cache?.frontmatter?.['pm-project'] === true) return false
        if (checking) return true
        void this.showTasksForPerson(personLink(this.app, file, ''))
        return true
      }
    })

    this.addCommand({
      id: 'link-people-to-notes',
      name: 'Link assignees to their person notes',
      callback: () => {
        void this.linkPeopleToNotes()
      }
    })

    this.addSettingTab(new PMSettingTab(this.app, this))
    this.notifier.start()
  }

  onunload(): void {
    this.notifier.stop()
  }

  /** Opens a task note in Obsidian's own editor, where the swap leaves it alone. */
  async openAsMarkdown(path: string): Promise<void> {
    this.markdownEscapes.add(path)
    await this.app.workspace.openLinkText(path, '', true)
  }

  private registerTaskNoteSwap(): void {
    const swap = (): void => this.swapTaskNotes()
    this.registerEvent(this.app.workspace.on('file-open', swap))
    this.registerEvent(this.app.workspace.on('layout-change', swap))
    this.registerEvent(this.app.workspace.on('active-leaf-change', swap))
  }

  /**
   * Sweeps every markdown leaf rather than the one being opened: a note opened into a
   * background tab reports no file-open at all, and one that replaces the active leaf
   * reports it while Obsidian is still building the view it is about to overwrite.
   */
  private swapTaskNotes(): void {
    if (this.settings.taskEditorSurface !== 'tab') return
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view
      if (!(view instanceof MarkdownView)) continue
      const file = view.file
      if (!file || this.markdownEscapes.has(file.path)) continue
      if (this.app.metadataCache.getFileCache(file)?.frontmatter?.['pm-task'] !== true) continue
      void leaf.setViewState({ type: PM_TASK_VIEW_TYPE, state: { filePath: file.path } })
    }
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<PMSettings> | null
    // Cloned: a shallow merge would hand the live settings the very arrays and objects
    // DEFAULT_SETTINGS holds, and the first edit would write into the defaults.
    this.settings = Object.assign(structuredClone(DEFAULT_SETTINGS), saved ?? {})
    if (!saved?.statuses?.length) this.settings.statuses = structuredClone(DEFAULT_SETTINGS.statuses)
    if (!saved?.priorities?.length) this.settings.priorities = structuredClone(DEFAULT_SETTINGS.priorities)
    if (!this.settings.projectFilters) this.settings.projectFilters = {}
    if (!this.settings.scopeViews) this.settings.scopeViews = {}
    if (!this.settings.collapsedTasks) this.settings.collapsedTasks = {}
    if (!this.settings.collapsedProjects) this.settings.collapsedProjects = []
    if (!this.settings.excludedFolders) this.settings.excludedFolders = []

    let migrated = false
    // Filters were keyed by project path before a view could cover several projects.
    for (const key of Object.keys(this.settings.projectFilters)) {
      if (key.includes(':')) continue
      this.settings.projectFilters[`project:${key}`] = this.settings.projectFilters[key]
      Reflect.deleteProperty(this.settings.projectFilters, key)
      migrated = true
    }

    for (const s of this.settings.statuses) {
      if (s.complete === undefined) {
        s.complete = s.id === 'done' || s.id === 'cancelled'
        migrated = true
      }
    }

    // ganttHideDone was a global toggle, now expressed as a per-project status filter.
    const legacy = (saved ?? {}) as { ganttHideDone?: boolean }
    if (legacy.ganttHideDone === true) {
      const nonTerminal = this.settings.statuses.filter((s) => !s.complete).map((s) => s.id)
      for (const entry of Object.values(this.settings.projectFilters)) {
        if (entry.filter.statuses.length === 0) {
          entry.filter.statuses = nonTerminal
        }
      }
      migrated = true
    }

    if (migrated) await this.saveSettings()
  }

  /**
   * A scope key is `vault`, or a kind and a path. Only the path-bearing ones can go
   * stale, and a key that names no path at all is kept rather than guessed at.
   */
  private scopeKeyResolves(key: string): boolean {
    const separator = key.indexOf(':')
    if (separator === -1) return true
    const path = key.slice(separator + 1)
    return path === '' || this.app.vault.getAbstractFileByPath(path) !== null
  }

  /** The startup work that reads the index: migration, pruning, and the first due sweep. */
  private async startupSweep(): Promise<void> {
    await migrateProjects(this)
    await this.cleanupStaleProjectFilters()
    this.notifier.check()
  }

  async cleanupStaleProjectFilters(): Promise<void> {
    const filters = this.settings.projectFilters
    const cleaned: typeof filters = {}
    let dirty = false
    for (const [key, entry] of Object.entries(filters)) {
      if (this.scopeKeyResolves(key)) {
        cleaned[key] = entry
      } else {
        dirty = true
      }
    }
    const cleanedScopeViews: typeof this.settings.scopeViews = {}
    for (const [key, views] of Object.entries(this.settings.scopeViews)) {
      if (this.scopeKeyResolves(key)) {
        cleanedScopeViews[key] = views
      } else {
        dirty = true
      }
    }
    const cleanedCollapsed: typeof this.settings.collapsedTasks = {}
    for (const [path, ids] of Object.entries(this.settings.collapsedTasks)) {
      if (this.app.vault.getAbstractFileByPath(path)) {
        cleanedCollapsed[path] = ids
      } else {
        dirty = true
      }
    }
    const collapsedProjects = this.settings.collapsedProjects.filter((path) =>
      this.app.vault.getAbstractFileByPath(path)
    )
    if (collapsedProjects.length !== this.settings.collapsedProjects.length) dirty = true
    if (dirty) {
      this.settings.projectFilters = cleaned
      this.settings.scopeViews = cleanedScopeViews
      this.settings.collapsedTasks = cleanedCollapsed
      this.settings.collapsedProjects = collapsedProjects
      await this.saveSettings()
    }
  }

  /** A project with no record yet keeps whatever legacy frontmatter said. */
  applyCollapsedState(project: Project): void {
    const ids = this.settings.collapsedTasks[project.filePath]
    if (!ids) return
    const set = new Set(ids)
    for (const { task } of flattenTasks(project.tasks)) {
      task.collapsed = set.has(task.id)
    }
  }

  /** Call after toggling task.collapsed. */
  async persistCollapsedState(project: Project): Promise<void> {
    this.settings.collapsedTasks[project.filePath] = flattenTasks(project.tasks)
      .filter((f) => f.task.collapsed)
      .map((f) => f.task.id)
    await this.saveSettings()
  }

  isProjectCollapsed(path: string): boolean {
    return this.settings.collapsedProjects.includes(path)
  }

  async toggleProjectCollapsed(path: string): Promise<void> {
    const collapsed = this.settings.collapsedProjects
    const at = collapsed.indexOf(path)
    if (at === -1) collapsed.push(path)
    else collapsed.splice(at, 1)
    await this.saveSettings()
  }

  /** Resolves by id against the live tree, so it works when a view renders filtered clones. */
  async toggleTaskCollapsed(project: Project, taskId: string): Promise<void> {
    const task = findTask(project.tasks, taskId)
    if (!task) return
    task.collapsed = !task.collapsed
    await this.persistCollapsedState(project)
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
  }

  showNotice(msg: string, duration = 3000): void {
    new Notice(msg, duration)
  }

  /**
   * A settings edit changed a palette or how a view draws itself. Nothing in the vault
   * moved, so the store's own change events say nothing about it. Coalesced, because a
   * list editor persists on every keystroke.
   */
  refreshViews(): void {
    if (this.viewRefreshScheduled) return
    this.viewRefreshScheduled = true
    window.setTimeout(() => {
      this.viewRefreshScheduled = false
      for (const leaf of this.app.workspace.getLeavesOfType(PM_PROJECT_VIEW_TYPE)) {
        if (leaf.view instanceof ProjectView) leaf.view.redraw()
      }
      for (const leaf of this.app.workspace.getLeavesOfType(PM_DASHBOARD_VIEW_TYPE)) {
        if (leaf.view instanceof DashboardView) leaf.view.render()
      }
    }, 0)
  }

  /**
   * Offers every project in the vault, loading only the one chosen. `autoSelectSingle`
   * skips a picker that would have exactly one entry.
   */
  private pickProject(onChoose: (project: Project) => void, autoSelectSingle: boolean): void {
    const refs = this.index.projectRefs()
    if (!refs.length) {
      this.showNotice(
        this.index.ready
          ? 'No projects yet. Create a project first.'
          : 'Still looking for projects. Try again in a moment.'
      )
      return
    }
    const choose = (ref: ProjectRef): void => {
      void (async () => {
        const file = this.app.vault.getAbstractFileByPath(ref.path)
        const project = file instanceof TFile ? await this.store.loadProject(file) : null
        if (!project) {
          this.showNotice(`Could not open "${ref.title}".`)
          return
        }
        onChoose(project)
      })()
    }
    if (autoSelectSingle && refs.length === 1) choose(refs[0])
    else openProjectPicker(this, refs, choose)
  }

  /**
   * Rewrites plain-text assignees and members as links to the notes of the same name, so
   * existing vaults get the graph edges without retyping every task. Names matching no note,
   * or more than one, are left alone and reported.
   */
  private async linkPeopleToNotes(): Promise<void> {
    const plain: string[] = []
    for (const ref of this.index.allTaskRefs()) plain.push(...ref.assignees)
    for (const ref of this.index.projectRefs()) plain.push(...ref.teamMembers)
    const names = dedupePeople(plain.filter((value) => !value.trim().startsWith('[[')))
    if (names.length === 0) {
      this.showNotice('Every assignee already links to a note.')
      return
    }

    const matches = matchPersonNotes(this.app, this.settings.peopleFolder, names)
    const linkable = matches.filter((match) => match.link !== null)
    const ambiguous = matches.filter((match) => match.ambiguous)
    if (linkable.length === 0) {
      this.showNotice(`No note matches any of the ${names.length} name(s) in use.`)
      return
    }

    const linkFor = new Map<string, string>()
    for (const match of linkable) if (match.link) linkFor.set(match.name.trim().toLowerCase(), match.link)
    const mapValue = (value: string): string =>
      value.trim().startsWith('[[') ? value : (linkFor.get(value.trim().toLowerCase()) ?? value)

    const preview = linkable
      .slice(0, 5)
      .map((match) => match.name)
      .join(', ')
    const extra = linkable.length > 5 ? `, and ${linkable.length - 5} more` : ''
    const warn = ambiguous.length ? ` ${ambiguous.length} name(s) match several notes and are left alone.` : ''
    const ok = await confirmDialog(
      this.app,
      `Link ${linkable.length} name(s) to their notes: ${preview}${extra}.${warn}`,
      'Link'
    )
    if (!ok) return

    let tasksChanged = 0
    let projectsChanged = 0
    const byProject = new Map<string, string[]>()
    for (const ref of this.index.allTaskRefs()) {
      if (!ref.projectPath) continue
      if (!ref.assignees.some((value) => linkFor.has(value.trim().toLowerCase()))) continue
      const bucket = byProject.get(ref.projectPath)
      if (bucket) bucket.push(ref.id)
      else byProject.set(ref.projectPath, [ref.id])
    }

    for (const [path, taskIds] of byProject) {
      const project = await this.loadProjectAt(path)
      if (!project) continue
      await this.store.updateTasks(project, taskIds, (task) => ({ assignees: task.assignees.map(mapValue) }))
      tasksChanged += taskIds.length
    }

    for (const ref of this.index.projectRefs()) {
      if (!ref.teamMembers.some((value) => linkFor.has(value.trim().toLowerCase()))) continue
      const project = await this.loadProjectAt(ref.path)
      if (!project) continue
      await this.store.updateProject(project, { teamMembers: project.teamMembers.map(mapValue) })
      projectsChanged++
    }

    this.refreshViews()
    this.showNotice(`Linked ${tasksChanged} task(s) and ${projectsChanged} project(s).`)
  }

  private async loadProjectAt(path: string): Promise<Project | null> {
    const file = this.app.vault.getAbstractFileByPath(path)
    return file instanceof TFile ? this.store.loadProject(file) : null
  }

  /** Opens the whole vault filtered to one person, the way the assignee filter would. */
  private async showTasksForPerson(person: string): Promise<void> {
    const name = displayName(person)
    if (this.index.tasksForPerson(person).length === 0) {
      new Notice(`No tasks assigned to ${name}`)
      return
    }
    this.settings.projectFilters[scopeKey({ kind: 'vault' })] = {
      filter: { ...makeDefaultFilter(), assignees: [person] },
      activeSavedViewId: null
    }
    await this.saveSettings()
    await this.router.openScope({ kind: 'vault' })
  }

  /** Picks a project, then a parent when creating a subtask, before opening the editor. */
  private pickProjectThenCreateTask(mode: null | 'pick-parent'): void {
    this.pickProject((project) => {
      if (mode === 'pick-parent') {
        const flat = flattenTasks(project.tasks)
        if (!flat.length) {
          this.showNotice('No tasks in this project. Create a task first.')
          return
        }
        openTaskPicker(
          this,
          flat.map((f) => f.task),
          (parentTask) => {
            this.openTaskModalForProject(project, parentTask.id)
          }
        )
      } else {
        this.openTaskModalForProject(project, null)
      }
    }, false)
  }

  private openTaskModalForProject(project: Project, parentId: string | null, defaults?: Partial<Task>): void {
    openTaskModal(this, project, {
      parentId,
      defaults,
      onSave: async () => {
        await this.store.saveProject(project)
        await this.router.openProjectByPath(project.filePath)
      }
    })
  }

  /** Open the task modal pre-filled from selected text, targeting a chosen project. */
  private createTaskFromText(text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return

    const newlineIdx = trimmed.indexOf('\n')
    const defaults: Partial<Task> =
      newlineIdx === -1
        ? { title: trimmed }
        : { title: trimmed.slice(0, newlineIdx).trim(), description: trimmed.slice(newlineIdx + 1).trim() }

    this.pickProject((project) => {
      this.openTaskModalForProject(project, null, defaults)
    }, true)
  }

  private importNotes(): void {
    const activeLeaves = this.app.workspace.getLeavesOfType(PM_PROJECT_VIEW_TYPE)
    let activeProject: Project | null = null

    for (const leaf of activeLeaves) {
      if (!(leaf.view instanceof ProjectView)) continue
      if (leaf.view.project) {
        activeProject = leaf.view.project
        break
      }
    }

    if (activeProject) {
      const project = activeProject
      const onImportComplete = async () => {
        await this.router.openProjectByPath(project.filePath)
      }
      openImportModal(this, activeProject, onImportComplete)
      return
    }

    this.pickProject((project) => {
      const onImportComplete = async () => {
        await this.router.openProjectByPath(project.filePath)
      }
      openImportModal(this, project, onImportComplete)
    }, false)
  }
}

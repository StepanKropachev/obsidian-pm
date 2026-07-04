import { App, Modal, TFile, Notice } from 'obsidian'
import type PMPlugin from '../main'
import type { PriorityConfig, Project, StatusConfig, TaskStatus, TaskPriority } from '../types'
import { getDefaultStatusId, getDefaultPriorityId } from '../utils'
import {
  ensurePaletteEntries,
  getTaskNotesApi,
  resolveTaskNotesRef,
  type TaskNotesApi,
  type TaskNotesTaskInfo
} from '../integrations/tasknotes'
import { buildImportForest, type TaskNotesImportItem } from '../integrations/tasknotesImport'

interface FileItem {
  file: TFile
  folder: string
  selected: boolean
}

export class ImportModal extends Modal {
  private files: FileItem[] = []
  private filteredFiles: FileItem[] = []
  private selectedCount = 0
  private searchInput: HTMLInputElement | null = null
  private selectAllCheckbox: HTMLInputElement | null = null
  private nextButton: HTMLButtonElement | null = null
  private fileListContainer: HTMLDivElement | null = null
  private counterLabel: HTMLDivElement | null = null

  // Phase 2 state
  private phase: 1 | 2 = 1
  private defaultStatus: TaskStatus
  private defaultPriority: TaskPriority
  private fileHandling: 'move' | 'copy' = 'move'
  private project: Project | null = null
  private onImportComplete: (() => void) | null = null

  constructor(
    app: App,
    private plugin: PMPlugin
  ) {
    super(app)
    this.defaultStatus = getDefaultStatusId(plugin.settings.statuses)
    this.defaultPriority = getDefaultPriorityId(plugin.settings.priorities)
  }

  /** Palettes in effect for the import target; the global ones until setProject has run. */
  private get palettes(): { statuses: StatusConfig[]; priorities: PriorityConfig[] } {
    return this.project ? this.plugin.store.configFor(this.project) : this.plugin.settings
  }

  onOpen(): void {
    const palettes = this.palettes
    this.defaultStatus = getDefaultStatusId(palettes.statuses)
    this.defaultPriority = getDefaultPriorityId(palettes.priorities)

    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('import-modal')
    this.modalEl.addClass('import-modal-container')

    // Load all markdown files from vault
    this.loadVaultFiles()

    this.render()
  }

  onClose(): void {
    this.contentEl.empty()
  }

  private loadVaultFiles(): void {
    const allFiles = this.app.vault.getFiles()
    const markdownFiles = allFiles.filter((f) => f.extension === 'md')

    this.files = markdownFiles.map((file) => {
      const folder = file.parent?.path || '/'
      return {
        file,
        folder: folder === '/' ? '/' : folder,
        selected: false
      }
    })

    this.filteredFiles = [...this.files]
  }

  private render(): void {
    if (this.phase === 1) {
      this.renderPhase1()
    } else {
      this.renderPhase2()
    }
  }

  private renderPhase1(): void {
    const { contentEl } = this
    contentEl.empty()

    // ── Header ──────────────────────────────────────────────────────────────
    const header = contentEl.createDiv('import-modal-header')

    header.createEl('h2', { text: 'Select notes to import' })

    this.counterLabel = header.createDiv('import-counter')
    this.updateCounter()

    // ── Search input ────────────────────────────────────────────────────────
    const searchContainer = contentEl.createDiv('import-search-container')

    this.searchInput = searchContainer.createEl('input', {
      type: 'text',
      cls: 'prompt-input import-search-input',
      placeholder: 'Search files...'
    })
    this.searchInput.addEventListener('input', () => this.handleSearch())

    // ── File list ───────────────────────────────────────────────────────────
    const listContainer = contentEl.createDiv('import-list-wrapper')

    this.fileListContainer = listContainer

    // Select All row
    const selectAllRow = listContainer.createDiv('import-select-all-row')

    this.selectAllCheckbox = selectAllRow.createEl('input', {
      type: 'checkbox'
    })
    this.selectAllCheckbox.addEventListener('change', () => this.handleSelectAll())

    const selectAllLabel = selectAllRow.createEl('label', { text: 'Select all' })
    selectAllLabel.addEventListener('click', () => {
      if (this.selectAllCheckbox) {
        this.selectAllCheckbox.checked = !this.selectAllCheckbox.checked
        this.handleSelectAll()
      }
    })

    // File list items
    this.renderFileList()

    // ── Footer with Next button ────────────────────────────────────────────
    const footer = contentEl.createDiv('import-modal-footer')

    const cancelButton = footer.createEl('button', { text: 'Cancel', cls: 'import-btn import-btn--secondary' })
    cancelButton.addEventListener('click', () => this.close())

    this.nextButton = footer.createEl('button', { text: 'Next', cls: 'mod-cta import-btn' })
    this.nextButton.toggleClass('import-btn--disabled', this.selectedCount === 0)
    this.nextButton.disabled = this.selectedCount === 0
    this.nextButton.addEventListener('click', () => this.handleNext())
  }

  private renderPhase2(): void {
    const { contentEl } = this
    contentEl.empty()

    // ── Header ──────────────────────────────────────────────────────────────
    const header = contentEl.createDiv('import-options-header')
    header.createEl('h2', { text: 'Import options' })

    // ── Content ──────────────────────────────────────────────────────────────
    const content = contentEl.createDiv('import-options-content')

    // Status dropdown
    const statusGroup = content.createDiv('import-option-group')
    statusGroup.createEl('label', { text: 'Default status' })

    const statusSelect = statusGroup.createEl('select')

    this.palettes.statuses.forEach((s) => {
      const option = statusSelect.createEl('option', { text: s.label })
      option.value = s.id
      if (s.id === this.defaultStatus) option.selected = true
    })

    statusSelect.addEventListener('change', (e) => {
      this.defaultStatus = (e.target as HTMLSelectElement).value
    })

    // Priority dropdown
    const priorityGroup = content.createDiv('import-option-group')
    priorityGroup.createEl('label', { text: 'Default priority' })

    const prioritySelect = priorityGroup.createEl('select')

    this.palettes.priorities.forEach((p) => {
      const option = prioritySelect.createEl('option', { text: p.label })
      option.value = p.id
      if (p.id === this.defaultPriority) option.selected = true
    })

    prioritySelect.addEventListener('change', (e) => {
      this.defaultPriority = (e.target as HTMLSelectElement).value
    })

    // File handling radio
    const handlingGroup = content.createDiv('import-option-group')
    handlingGroup.createEl('label', { text: 'File handling' })

    const radioGroup = handlingGroup.createDiv('import-radio-group')

    // Move option
    const moveLabel = radioGroup.createEl('label')

    const moveRadio = moveLabel.createEl('input', { type: 'radio' })
    moveRadio.name = 'file-handling'
    moveRadio.value = 'move'
    moveRadio.checked = this.fileHandling === 'move'
    moveRadio.addEventListener('change', () => {
      this.fileHandling = 'move'
    })

    moveLabel.createSpan({ text: 'Move to tasks folder (default)' })

    // Copy option
    const copyLabel = radioGroup.createEl('label')

    const copyRadio = copyLabel.createEl('input', { type: 'radio' })
    copyRadio.name = 'file-handling'
    copyRadio.value = 'copy'
    copyRadio.checked = this.fileHandling === 'copy'
    copyRadio.addEventListener('change', () => {
      this.fileHandling = 'copy'
    })

    copyLabel.createSpan({ text: 'Copy (keep original)' })

    // ── Footer ───────────────────────────────────────────────────────────────
    const footer = contentEl.createDiv('import-modal-footer')

    const backButton = footer.createEl('button', { text: 'Back', cls: 'import-btn import-btn--secondary' })
    backButton.addEventListener('click', () => this.handleBack())

    const importButton = footer.createEl('button', {
      text: `Import (${this.selectedCount})`,
      cls: 'mod-cta import-btn'
    })
    importButton.addEventListener('click', () => {
      void this.handleImport()
    })
  }

  private applyRowStyles(row: HTMLDivElement, isSelected: boolean): void {
    row.toggleClass('import-file-item--selected', isSelected)
  }

  private renderFileList(): void {
    const fileListContainer = this.fileListContainer
    if (!fileListContainer) return

    // Clear existing items (keep the select-all row)
    const items = fileListContainer.querySelectorAll('.import-file-item')
    items.forEach((item) => item.remove())

    this.filteredFiles.forEach((item) => {
      const row = fileListContainer.createDiv('import-file-item suggestion-item')
      this.applyRowStyles(row, item.selected)

      const checkbox = row.createEl('input', { type: 'checkbox' })
      checkbox.checked = item.selected
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation()
        item.selected = checkbox.checked
        this.updateCounter()
        this.updateSelectAllCheckbox()
        this.updateNextButton()
        this.applyRowStyles(row, item.selected)
      })

      row.createSpan({ text: item.file.basename, cls: 'import-file-name' })
      row.createSpan({ text: item.folder, cls: 'import-file-folder' })

      row.addEventListener('click', (e) => {
        // Don't toggle if clicking the checkbox itself — let native change event handle it
        if (e.target === checkbox) return

        // Toggle checkbox for clicks elsewhere in the row, which will trigger the change event
        checkbox.checked = !checkbox.checked
        checkbox.dispatchEvent(new Event('change', { bubbles: true }))
      })
    })
  }

  private handleSearch(): void {
    const query = this.searchInput?.value.toLowerCase() || ''
    this.filteredFiles = this.files.filter(
      (item) => item.file.basename.toLowerCase().includes(query) || item.folder.toLowerCase().includes(query)
    )
    this.renderFileList()
  }

  private handleSelectAll(): void {
    const isChecked = this.selectAllCheckbox?.checked || false
    this.filteredFiles.forEach((item) => {
      item.selected = isChecked
    })
    this.updateCounter()
    this.updateNextButton()
    this.renderFileList()
  }

  private updateCounter(): void {
    if (!this.counterLabel) return
    const count = this.files.filter((f) => f.selected).length
    this.selectedCount = count
    this.counterLabel.setText(`${count} selected`)
  }

  private updateSelectAllCheckbox(): void {
    if (!this.selectAllCheckbox) return
    const allFiltered = this.filteredFiles.length > 0
    const allSelected = allFiltered && this.filteredFiles.every((f) => f.selected)
    this.selectAllCheckbox.checked = allSelected
  }

  private updateNextButton(): void {
    if (!this.nextButton) return
    this.nextButton.disabled = this.selectedCount === 0
    this.nextButton.toggleClass('import-btn--disabled', this.selectedCount === 0)
  }

  private handleNext(): void {
    if (this.selectedCount === 0) return
    this.phase = 2
    this.render()
  }

  private handleBack(): void {
    this.phase = 1
    this.render()
  }

  private async handleImport(): Promise<void> {
    if (!this.project) {
      new Notice('Error: project not set for import', 5000)
      return
    }

    const selectedFiles = this.files.filter((f) => f.selected).map((f) => f.file)
    let skipped = 0
    let imported = 0

    const api = getTaskNotesApi(this.app)
    const taskNotesApi = api?.hasCapability('tasks.read') ? api : null
    const taskNotesTasks: Array<{ file: TFile; info: TaskNotesTaskInfo }> = []

    for (const file of selectedFiles) {
      const alreadyPmTask = this.app.metadataCache.getFileCache(file)?.frontmatter?.['pm-task'] === true
      if (taskNotesApi && !alreadyPmTask) {
        const info = await taskNotesApi.getTask(file.path).catch(() => null)
        if (info) {
          taskNotesTasks.push({ file, info })
          continue
        }
      }
      try {
        const result = await this.plugin.store.importNoteAsTask(this.project, file, {
          status: this.defaultStatus,
          priority: this.defaultPriority,
          handling: this.fileHandling
        })
        if (result === 'imported') imported++
        else skipped++
      } catch (err) {
        console.error(`Failed to import ${file.basename}:`, err)
        skipped++
      }
    }

    if (taskNotesApi && taskNotesTasks.length) {
      try {
        imported += await this.importTaskNotesTasks(taskNotesApi, this.project, taskNotesTasks)
      } catch (err) {
        console.error('Failed to import TaskNotes tasks:', err)
        skipped += taskNotesTasks.length
      }
    }

    if (this.onImportComplete) {
      this.onImportComplete()
    }

    let message = `Imported ${imported} task${imported !== 1 ? 's' : ''}`
    if (skipped > 0) {
      message += ` (${skipped} skipped)`
    }
    new Notice(message, 3000)

    this.close()
  }

  /**
   * Convert TaskNotes tasks preserving their fields: scheduled/due dates,
   * blockedBy dependencies and project-link hierarchy (within the selection),
   * tags, time estimate, completion, and archive state.
   */
  private async importTaskNotesTasks(
    api: TaskNotesApi,
    project: Project,
    tasks: Array<{ file: TFile; info: TaskNotesTaskInfo }>
  ): Promise<number> {
    const snapshot = api.hasCapability('settings.snapshot') ? api.getSettingsSnapshot() : {}
    const taskTag = snapshot.taskTag || 'task'
    const archiveTag = snapshot.fieldMapping?.archiveTag || 'archived'

    const resolve = (refs: string[] | undefined, sourcePath: string): string[] =>
      (refs ?? []).map((ref) => resolveTaskNotesRef(this.app, ref, sourcePath)).filter((p): p is string => p !== null)

    const items: TaskNotesImportItem[] = tasks.map(({ file, info }) => ({
      path: file.path,
      info,
      parentPaths: resolve(info.projects, file.path),
      blockedByPaths: resolve(
        (info.blockedBy ?? []).map((dep) => (typeof dep === 'string' ? dep : dep.uid)),
        file.path
      )
    }))

    const { roots, byPath } = buildImportForest(items, {
      defaultStatus: this.defaultStatus,
      defaultPriority: this.defaultPriority,
      taskTag,
      archiveTag
    })

    const usedStatuses = new Set(items.map((i) => i.info.status).filter(Boolean))
    const usedPriorities = new Set(items.map((i) => i.info.priority).filter(Boolean))
    if (ensurePaletteEntries(api, this.plugin.settings, usedStatuses, usedPriorities) > 0) {
      await this.plugin.saveSettings()
    }

    const sources = new Map<string, TFile>()
    for (const { file } of tasks) {
      const task = byPath.get(file.path)
      if (task) sources.set(task.id, file)
    }
    return this.plugin.store.importTaskForest(project, roots, sources, this.fileHandling)
  }

  setProject(project: Project): void {
    this.project = project
  }

  setOnImportComplete(handler: () => void): void {
    this.onImportComplete = handler
  }
}

import { Modal, TFile, Notice } from 'obsidian'
import type { Project, TaskStatus, TaskPriority } from '../types'
import { makeTask, DEFAULT_STATUSES, DEFAULT_PRIORITIES } from '../types'
import { parseFrontmatter, TASK_FRONTMATTER_KEY } from '../store/YamlParser'
import { serializeTask, taskFilePath } from '../store/YamlSerializer'
import { ensureFolder } from '../store/vaultFs'

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
  private onConfirm: ((selectedFiles: TFile[]) => void) | null = null

  // Phase 2 state
  private phase: 1 | 2 = 1
  private defaultStatus: TaskStatus = 'todo'
  private defaultPriority: TaskPriority = 'medium'
  private fileHandling: 'move' | 'copy' = 'move'
  private project: Project | null = null
  private onImportComplete: (() => void) | null = null

  onOpen(): void {
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

    DEFAULT_STATUSES.forEach((s) => {
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

    DEFAULT_PRIORITIES.forEach((p) => {
      const option = prioritySelect.createEl('option', { text: p.label })
      option.value = p.id
      if (p.id === this.defaultPriority) option.selected = true
    })

    prioritySelect.addEventListener('change', (e) => {
      this.defaultPriority = (e.target as HTMLSelectElement).value as TaskPriority
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

    moveLabel.createEl('span', { text: 'Move to tasks folder (default)' })

    // Copy option
    const copyLabel = radioGroup.createEl('label')

    const copyRadio = copyLabel.createEl('input', { type: 'radio' })
    copyRadio.name = 'file-handling'
    copyRadio.value = 'copy'
    copyRadio.checked = this.fileHandling === 'copy'
    copyRadio.addEventListener('change', () => {
      this.fileHandling = 'copy'
    })

    copyLabel.createEl('span', { text: 'Copy (keep original)' })

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
    if (!this.fileListContainer) return

    // Clear existing items (keep the select-all row)
    const items = this.fileListContainer.querySelectorAll('.import-file-item')
    items.forEach((item) => item.remove())

    this.filteredFiles.forEach((item) => {
      const row = this.fileListContainer!.createDiv('import-file-item suggestion-item')
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

      row.createEl('span', { text: item.file.basename, cls: 'import-file-name' })
      row.createEl('span', { text: item.folder, cls: 'import-file-folder' })

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
    const skipped: string[] = []
    const imported: string[] = []

    try {
      // Task folder mirrors ProjectStore.projectTaskFolder: <projectFile>_tasks
      const tasksFolder = this.project.filePath.replace(/\.md$/, '_tasks')

      for (const file of selectedFiles) {
        try {
          // Read file content
          const content = await this.app.vault.read(file)

          // Parse frontmatter
          const { frontmatter, body } = parseFrontmatter(content)

          // Check if already imported
          if (frontmatter && frontmatter[TASK_FRONTMATTER_KEY] === true) {
            skipped.push(file.basename)
            continue
          }

          // Create task
          const task = makeTask({
            title: file.basename.replace(/\.md$/, ''),
            description: body,
            status: this.defaultStatus,
            priority: this.defaultPriority
          })

          // Generate file path for task
          const newFilePath = taskFilePath(task.title, task.id, tasksFolder)

          // Serialize task to file content
          const newContent = serializeTask(task, this.project, null)

          if (this.fileHandling === 'move') {
            // Move: rename to new location, then update content
            try {
              await ensureFolder(this.app, tasksFolder)

              // Rename file to new path
              await this.app.fileManager.renameFile(file, newFilePath)

              // Get the moved file and update its content
              const movedFile = this.app.vault.getAbstractFileByPath(newFilePath)
              if (movedFile instanceof TFile) {
                await this.app.vault.modify(movedFile, newContent)
              }

              imported.push(file.basename)
            } catch (err) {
              console.error(`Failed to move ${file.basename}:`, err)
              skipped.push(file.basename)
            }
          } else {
            // Copy: create new file, keep original
            try {
              await ensureFolder(this.app, tasksFolder)

              await this.app.vault.create(newFilePath, newContent)
              imported.push(file.basename)
            } catch (err) {
              console.error(`Failed to copy ${file.basename}:`, err)
              skipped.push(file.basename)
            }
          }
        } catch (err) {
          console.error(`Error processing ${file.basename}:`, err)
          skipped.push(file.basename)
        }
      }

      // Call project reload callback if provided
      if (this.onImportComplete) {
        this.onImportComplete()
      }

      // Show summary notification
      let message = `Imported ${imported.length} task${imported.length !== 1 ? 's' : ''}`
      if (skipped.length > 0) {
        message += ` (${skipped.length} skipped)`
      }
      new Notice(message, 3000)

      this.close()
    } catch (err) {
      console.error('Import error:', err)
      new Notice('Error during import. Check console for details.', 5000)
    }
  }

  setOnConfirm(callback: (selectedFiles: TFile[]) => void): void {
    this.onConfirm = callback
  }

  setProject(project: Project): void {
    this.project = project
  }

  setOnImportComplete(callback: () => void): void {
    this.onImportComplete = callback
  }
}

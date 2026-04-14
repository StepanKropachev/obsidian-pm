import { App, Modal, TFile, Notice } from 'obsidian';
import type { Project, TaskStatus, TaskPriority } from '../types';
import { makeTask } from '../types';
import { parseFrontmatter, TASK_FRONTMATTER_KEY } from '../store/YamlParser';
import { serializeTask, taskFilePath } from '../store/YamlSerializer';

interface FileItem {
  file: TFile;
  folder: string;
  selected: boolean;
}

export class ImportModal extends Modal {
  private files: FileItem[] = [];
  private filteredFiles: FileItem[] = [];
  private selectedCount = 0;
  private searchInput: HTMLInputElement | null = null;
  private selectAllCheckbox: HTMLInputElement | null = null;
  private nextButton: HTMLButtonElement | null = null;
  private fileListContainer: HTMLDivElement | null = null;
  private counterLabel: HTMLDivElement | null = null;
  private onConfirm: ((selectedFiles: TFile[]) => void) | null = null;

  // Phase 2 state
  private phase: 1 | 2 = 1;
  private defaultStatus: TaskStatus = 'todo';
  private defaultPriority: TaskPriority = 'medium';
  private fileHandling: 'move' | 'copy' = 'move';
  private project: Project | null = null;
  private onImportComplete: (() => void) | null = null;

  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('import-modal');
    this.modalEl.addClass('import-modal-container');

    // Load all markdown files from vault
    this.loadVaultFiles();

    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private loadVaultFiles(): void {
    const allFiles = this.app.vault.getFiles();
    const markdownFiles = allFiles.filter(f => f.extension === 'md');

    this.files = markdownFiles.map(file => {
      const folder = file.parent?.path || '/';
      return {
        file,
        folder: folder === '/' ? '/' : folder,
        selected: false,
      };
    });

    this.filteredFiles = [...this.files];
  }

  private render(): void {
    if (this.phase === 1) {
      this.renderPhase1();
    } else {
      this.renderPhase2();
    }
  }

  private renderPhase1(): void {
    const { contentEl } = this;
    contentEl.empty();

    // ── Header ──────────────────────────────────────────────────────────────
    const header = contentEl.createDiv('import-modal-header');
    header.style.padding = '1rem';
    header.style.borderBottom = `1px solid var(--background-modifier-border, #e0e0e0)`;
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.gap = '1rem';

    const title = header.createEl('h2', { text: 'Select notes to import' });
    title.style.margin = '0';
    title.style.fontSize = '1.125rem';
    title.style.color = 'var(--text-normal, #2b3438)';

    this.counterLabel = header.createDiv('import-counter');
    this.counterLabel.style.color = 'var(--text-muted, #666)';
    this.counterLabel.style.fontSize = '0.875rem';
    this.updateCounter();

    // ── Search input ────────────────────────────────────────────────────────
    const searchContainer = contentEl.createDiv('import-search-container');
    searchContainer.style.padding = '1rem';
    searchContainer.style.borderBottom = `1px solid var(--background-modifier-border, #e0e0e0)`;

    this.searchInput = searchContainer.createEl('input', {
      type: 'text',
      cls: 'prompt-input',
      placeholder: 'Search files...',
    });
    this.searchInput.style.width = '100%';
    this.searchInput.style.padding = '0.5rem';
    this.searchInput.style.border = `1px solid var(--background-modifier-border, #e0e0e0)`;
    this.searchInput.style.borderRadius = '0.25rem';
    this.searchInput.style.backgroundColor = 'var(--background-primary, #fff)';
    this.searchInput.style.color = 'var(--text-normal, #2b3438)';
    this.searchInput.addEventListener('input', () => this.handleSearch());

    // ── File list ───────────────────────────────────────────────────────────
    const listContainer = contentEl.createDiv('import-list-wrapper');
    listContainer.style.flex = '1';
    listContainer.style.overflowY = 'auto';
    listContainer.style.overflowX = 'hidden';
    listContainer.style.maxHeight = '300px';
    listContainer.style.display = 'flex';
    listContainer.style.flexDirection = 'column';

    this.fileListContainer = listContainer;

    // Select All row
    const selectAllRow = listContainer.createDiv('import-select-all-row');
    selectAllRow.style.padding = '0.75rem 1rem';
    selectAllRow.style.display = 'flex';
    selectAllRow.style.alignItems = 'center';
    selectAllRow.style.gap = '0.75rem';
    selectAllRow.style.borderBottom = `1px solid var(--background-modifier-border, #e0e0e0)`;
    selectAllRow.style.backgroundColor = 'var(--background-secondary, #f5f5f5)';
    selectAllRow.style.position = 'sticky';
    selectAllRow.style.top = '0';
    selectAllRow.style.zIndex = '1';

    this.selectAllCheckbox = selectAllRow.createEl('input', {
      type: 'checkbox',
    });
    this.selectAllCheckbox.style.cursor = 'pointer';
    this.selectAllCheckbox.style.accentColor = 'var(--interactive-accent, #0066cc)';
    this.selectAllCheckbox.addEventListener('change', () => this.handleSelectAll());

    const selectAllLabel = selectAllRow.createEl('label', { text: 'Select All' });
    selectAllLabel.style.cursor = 'pointer';
    selectAllLabel.style.flex = '1';
    selectAllLabel.style.color = 'var(--text-normal, #2b3438)';
    selectAllLabel.style.marginBottom = '0';
    selectAllLabel.addEventListener('click', () => {
      if (this.selectAllCheckbox) {
        this.selectAllCheckbox.checked = !this.selectAllCheckbox.checked;
        this.handleSelectAll();
      }
    });

    // File list items
    this.renderFileList();

    // ── Footer with Next button ────────────────────────────────────────────
    const footer = contentEl.createDiv('import-modal-footer');
    footer.style.padding = '1rem';
    footer.style.borderTop = `1px solid var(--background-modifier-border, #e0e0e0)`;
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '0.75rem';

    const cancelButton = footer.createEl('button', { text: 'Cancel' });
    cancelButton.style.padding = '0.5rem 1rem';
    cancelButton.style.borderRadius = '0.25rem';
    cancelButton.style.border = `1px solid var(--background-modifier-border, #e0e0e0)`;
    cancelButton.style.backgroundColor = 'var(--background-primary, #fff)';
    cancelButton.style.color = 'var(--text-normal, #2b3438)';
    cancelButton.style.cursor = 'pointer';
    cancelButton.addEventListener('click', () => this.close());

    this.nextButton = footer.createEl('button', { text: 'Next →', cls: 'mod-cta' });
    this.nextButton.style.padding = '0.5rem 1rem';
    this.nextButton.style.borderRadius = '0.25rem';
    this.nextButton.style.cursor = this.selectedCount > 0 ? 'pointer' : 'not-allowed';
    this.nextButton.disabled = this.selectedCount === 0;
    this.nextButton.addEventListener('click', () => this.handleNext());
  }

  private renderPhase2(): void {
    const { contentEl } = this;
    contentEl.empty();

    // ── Header ──────────────────────────────────────────────────────────────
    const header = contentEl.createDiv('import-modal-header');
    header.style.padding = '1rem';
    header.style.borderBottom = `1px solid var(--background-modifier-border, #e0e0e0)`;

    const title = header.createEl('h2', { text: 'Import Options' });
    title.style.margin = '0';
    title.style.fontSize = '1.125rem';
    title.style.color = 'var(--text-normal, #2b3438)';

    // ── Content ──────────────────────────────────────────────────────────────
    const content = contentEl.createDiv('import-options-content');
    content.style.padding = '1.5rem';
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.gap = '1.5rem';

    // Status dropdown
    const statusGroup = content.createDiv('import-option-group');
    const statusLabel = statusGroup.createEl('label', { text: 'Default Status' });
    statusLabel.style.display = 'block';
    statusLabel.style.marginBottom = '0.5rem';
    statusLabel.style.fontWeight = '600';
    statusLabel.style.color = 'var(--text-normal, #2b3438)';

    const statusSelect = statusGroup.createEl('select');
    statusSelect.style.padding = '0.5rem 0.5rem';
    statusSelect.style.height = '2.25rem';
    statusSelect.style.lineHeight = '1.25rem';
    statusSelect.style.borderRadius = '0.25rem';
    statusSelect.style.border = `1px solid var(--background-modifier-border, #e0e0e0)`;
    statusSelect.style.backgroundColor = 'var(--background-primary, #fff)';
    statusSelect.style.color = 'var(--text-normal, #2b3438)';
    statusSelect.style.cursor = 'pointer';
    statusSelect.style.width = '100%';

    (['todo', 'in-progress', 'blocked'] as const).forEach(status => {
      const option = statusSelect.createEl('option', { text: status });
      option.value = status;
      if (status === this.defaultStatus) option.selected = true;
    });

    statusSelect.addEventListener('change', (e) => {
      this.defaultStatus = (e.target as HTMLSelectElement).value as TaskStatus;
    });

    // Priority dropdown
    const priorityGroup = content.createDiv('import-option-group');
    const priorityLabel = priorityGroup.createEl('label', { text: 'Default Priority' });
    priorityLabel.style.display = 'block';
    priorityLabel.style.marginBottom = '0.5rem';
    priorityLabel.style.fontWeight = '600';
    priorityLabel.style.color = 'var(--text-normal, #2b3438)';

    const prioritySelect = priorityGroup.createEl('select');
    prioritySelect.style.padding = '0.5rem';
    prioritySelect.style.borderRadius = '0.25rem';
    prioritySelect.style.border = `1px solid var(--background-modifier-border, #e0e0e0)`;
    prioritySelect.style.backgroundColor = 'var(--background-primary, #fff)';
    prioritySelect.style.color = 'var(--text-normal, #2b3438)';
    prioritySelect.style.cursor = 'pointer';
    prioritySelect.style.width = '100%';

    (['critical', 'high', 'medium', 'low'] as const).forEach(priority => {
      const option = prioritySelect.createEl('option', { text: priority });
      option.value = priority;
      if (priority === this.defaultPriority) option.selected = true;
    });

    prioritySelect.addEventListener('change', (e) => {
      this.defaultPriority = (e.target as HTMLSelectElement).value as TaskPriority;
    });

    // File handling radio
    const handlingGroup = content.createDiv('import-option-group');
    const handlingLabel = handlingGroup.createEl('label', { text: 'File Handling' });
    handlingLabel.style.display = 'block';
    handlingLabel.style.marginBottom = '0.75rem';
    handlingLabel.style.fontWeight = '600';
    handlingLabel.style.color = 'var(--text-normal, #2b3438)';

    const radioGroup = handlingGroup.createDiv();
    radioGroup.style.display = 'flex';
    radioGroup.style.flexDirection = 'column';
    radioGroup.style.gap = '0.5rem';

    // Move option
    const moveLabel = radioGroup.createEl('label');
    moveLabel.style.display = 'flex';
    moveLabel.style.alignItems = 'center';
    moveLabel.style.gap = '0.5rem';
    moveLabel.style.cursor = 'pointer';
    moveLabel.style.color = 'var(--text-normal, #2b3438)';

    const moveRadio = moveLabel.createEl('input', { type: 'radio' });
    moveRadio.name = 'file-handling';
    moveRadio.value = 'move';
    moveRadio.checked = this.fileHandling === 'move';
    moveRadio.style.cursor = 'pointer';
    moveRadio.addEventListener('change', () => {
      this.fileHandling = 'move';
    });

    moveLabel.createEl('span', { text: 'Move to tasks folder (default)' });

    // Copy option
    const copyLabel = radioGroup.createEl('label');
    copyLabel.style.display = 'flex';
    copyLabel.style.alignItems = 'center';
    copyLabel.style.gap = '0.5rem';
    copyLabel.style.cursor = 'pointer';
    copyLabel.style.color = 'var(--text-normal, #2b3438)';

    const copyRadio = copyLabel.createEl('input', { type: 'radio' });
    copyRadio.name = 'file-handling';
    copyRadio.value = 'copy';
    copyRadio.checked = this.fileHandling === 'copy';
    copyRadio.style.cursor = 'pointer';
    copyRadio.addEventListener('change', () => {
      this.fileHandling = 'copy';
    });

    copyLabel.createEl('span', { text: 'Copy (keep original)' });

    // ── Footer ───────────────────────────────────────────────────────────────
    const footer = contentEl.createDiv('import-modal-footer');
    footer.style.padding = '1rem';
    footer.style.borderTop = `1px solid var(--background-modifier-border, #e0e0e0)`;
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '0.75rem';

    const backButton = footer.createEl('button', { text: '← Back' });
    backButton.style.padding = '0.5rem 1rem';
    backButton.style.borderRadius = '0.25rem';
    backButton.style.border = `1px solid var(--background-modifier-border, #e0e0e0)`;
    backButton.style.backgroundColor = 'var(--background-primary, #fff)';
    backButton.style.color = 'var(--text-normal, #2b3438)';
    backButton.style.cursor = 'pointer';
    backButton.addEventListener('click', () => this.handleBack());

    const importButton = footer.createEl('button', { text: `Import (${this.selectedCount})`, cls: 'mod-cta' });
    importButton.style.padding = '0.5rem 1rem';
    importButton.style.borderRadius = '0.25rem';
    importButton.style.cursor = 'pointer';
    importButton.addEventListener('click', () => {
      void this.handleImport();
    });
  }

  private applyRowStyles(row: HTMLDivElement, isSelected: boolean): void {
    if (isSelected) {
      row.style.backgroundColor = 'var(--background-secondary, #2a2a2a)';
      row.style.borderLeft = `3px solid var(--interactive-accent, #0066cc)`;
      row.style.paddingLeft = 'calc(1rem - 3px)';
    } else {
      row.style.backgroundColor = 'transparent';
      row.style.borderLeft = 'none';
      row.style.paddingLeft = '0.75rem';
    }
  }

  private renderFileList(): void {
    if (!this.fileListContainer) return;

    // Clear existing items (keep the select-all row)
    const items = this.fileListContainer.querySelectorAll('.import-file-item');
    items.forEach(item => item.remove());

    this.filteredFiles.forEach((item) => {
      const row = this.fileListContainer!.createDiv('import-file-item suggestion-item');
      row.style.padding = '0.75rem 1rem';
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '0.75rem';
      row.style.borderBottom = `1px solid var(--background-modifier-border, #e0e0e0)`;
      row.style.cursor = 'pointer';
      row.style.transition = 'background-color 0.15s';
      this.applyRowStyles(row, item.selected);

      row.addEventListener('mouseenter', () => {
        if (!item.selected) {
          row.style.backgroundColor = 'var(--background-secondary, #f5f5f5)';
        }
      });
      row.addEventListener('mouseleave', () => {
        this.applyRowStyles(row, item.selected);
      });

      const checkbox = row.createEl('input', { type: 'checkbox' });
      checkbox.checked = item.selected;
      checkbox.style.cursor = 'pointer';
      checkbox.style.accentColor = 'var(--interactive-accent, #0066cc)';
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        item.selected = checkbox.checked;
        this.updateCounter();
        this.updateSelectAllCheckbox();
        this.updateNextButton();
        this.applyRowStyles(row, item.selected);
      });

      const nameEl = row.createEl('span', { text: item.file.basename });
      nameEl.style.flex = '1';
      nameEl.style.color = 'var(--text-normal, #2b3438)';
      nameEl.style.fontWeight = '500';

      const folderEl = row.createEl('span', { text: item.folder });
      folderEl.style.color = 'var(--text-muted, #666)';
      folderEl.style.fontSize = '0.875rem';

      row.addEventListener('click', (e) => {
        // Don't toggle if clicking the checkbox itself — let native change event handle it
        if (e.target === checkbox) return;

        // Toggle checkbox for clicks elsewhere in the row, which will trigger the change event
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  }

  private handleSearch(): void {
    const query = this.searchInput?.value.toLowerCase() || '';
    this.filteredFiles = this.files.filter(item =>
      item.file.basename.toLowerCase().includes(query) ||
      item.folder.toLowerCase().includes(query)
    );
    this.renderFileList();
  }

  private handleSelectAll(): void {
    const isChecked = this.selectAllCheckbox?.checked || false;
    this.filteredFiles.forEach(item => {
      item.selected = isChecked;
    });
    this.updateCounter();
    this.updateNextButton();
    this.renderFileList();
  }

  private updateCounter(): void {
    if (!this.counterLabel) return;
    const count = this.files.filter(f => f.selected).length;
    this.selectedCount = count;
    this.counterLabel.setText(`${count} selected`);
  }

  private updateSelectAllCheckbox(): void {
    if (!this.selectAllCheckbox) return;
    const allFiltered = this.filteredFiles.length > 0;
    const allSelected = allFiltered && this.filteredFiles.every(f => f.selected);
    this.selectAllCheckbox.checked = allSelected;
  }

  private updateNextButton(): void {
    if (!this.nextButton) return;
    this.nextButton.disabled = this.selectedCount === 0;
    this.nextButton.style.cursor = this.selectedCount > 0 ? 'pointer' : 'not-allowed';
    this.nextButton.style.opacity = this.selectedCount > 0 ? '1' : '0.5';
  }

  private handleNext(): void {
    if (this.selectedCount === 0) return;
    this.phase = 2;
    this.render();
  }

  private handleBack(): void {
    this.phase = 1;
    this.render();
  }

  private async handleImport(): Promise<void> {
    if (!this.project) {
      new Notice('Error: Project not set for import', 5000);
      return;
    }

    const selectedFiles = this.files.filter(f => f.selected).map(f => f.file);
    const skipped: string[] = [];
    const imported: string[] = [];

    try {
      // Task folder mirrors ProjectStore.projectTaskFolder: <projectFile>_tasks
      const tasksFolder = this.project.filePath.replace(/\.md$/, '_tasks');

      for (const file of selectedFiles) {
        try {
          // Read file content
          const content = await this.app.vault.read(file);

          // Parse frontmatter
          const { frontmatter, body } = parseFrontmatter(content);

          // Check if already imported
          if (frontmatter && frontmatter[TASK_FRONTMATTER_KEY] === true) {
            skipped.push(file.basename);
            continue;
          }

          // Create task
          const task = makeTask({
            title: file.basename.replace(/\.md$/, ''),
            description: body,
            status: this.defaultStatus,
            priority: this.defaultPriority,
          });

          // Generate file path for task
          const newFilePath = taskFilePath(task.title, task.id, tasksFolder);

          // Serialize task to file content
          const newContent = serializeTask(task, this.project, null);

          if (this.fileHandling === 'move') {
            // Move: rename to new location, then update content
            try {
              // Ensure tasks folder exists
              const tasksFolderExists = this.app.vault.getAbstractFileByPath(tasksFolder);
              if (!tasksFolderExists) {
                await this.app.vault.createFolder(tasksFolder);
              }

              // Rename file to new path
              await this.app.fileManager.renameFile(file, newFilePath);

              // Get the moved file and update its content
              const movedFile = this.app.vault.getAbstractFileByPath(newFilePath);
              if (movedFile instanceof TFile) {
                await this.app.vault.modify(movedFile, newContent);
              }

              imported.push(file.basename);
            } catch (err) {
              console.error(`Failed to move ${file.basename}:`, err);
              skipped.push(file.basename);
            }
          } else {
            // Copy: create new file, keep original
            try {
              // Ensure tasks folder exists
              const tasksFolderExists = this.app.vault.getAbstractFileByPath(tasksFolder);
              if (!tasksFolderExists) {
                await this.app.vault.createFolder(tasksFolder);
              }

              await this.app.vault.create(newFilePath, newContent);
              imported.push(file.basename);
            } catch (err) {
              console.error(`Failed to copy ${file.basename}:`, err);
              skipped.push(file.basename);
            }
          }
        } catch (err) {
          console.error(`Error processing ${file.basename}:`, err);
          skipped.push(file.basename);
        }
      }

      // Call project reload callback if provided
      if (this.onImportComplete) {
        this.onImportComplete();
      }

      // Show summary notification
      let message = `Imported ${imported.length} task${imported.length !== 1 ? 's' : ''}`;
      if (skipped.length > 0) {
        message += ` (${skipped.length} skipped)`;
      }
      new Notice(message, 3000);

      this.close();
    } catch (err) {
      console.error('Import error:', err);
      new Notice('Error during import. Check console for details.', 5000);
    }
  }

  setOnConfirm(callback: (selectedFiles: TFile[]) => void): void {
    this.onConfirm = callback;
  }

  setProject(project: Project): void {
    this.project = project;
  }

  setOnImportComplete(callback: () => void): void {
    this.onImportComplete = callback;
  }
}

import {
  App,
  ButtonComponent,
  Component,
  ExtraButtonComponent,
  Menu,
  Modal,
  MarkdownRenderer,
  Notice,
  setIcon
} from 'obsidian'
import type PMPlugin from '../main'
import { Project, Task, makeTask } from '../types'
import { flattenTasks } from '../store/TaskTreeOps'
import { TaskFileNameConflictError } from '../store'
import { safeAsync, getDefaultStatusId, getPriorityConfig } from '../utils'
import { confirmDialog } from '../ui/ModalFactory'
import { renderTaskFormFields } from './TaskFormFields'
import { renderTimeTrackingPanel } from './TimeTrackingPanel'
import { renderSubtasksPanel } from './SubtasksPanel'
import { NoteLinkSuggest } from './NoteLinkSuggest'

export class TaskModal extends Modal {
  private task: Task
  private isNew: boolean
  private originalParentId: string | null
  private cancelled = false
  private saved = false
  private persistPromise: Promise<void> | null = null
  private noteSuggest: NoteLinkSuggest | null = null
  private shownExtras = new Set<string>()
  private saveKeyHandler: ((e: KeyboardEvent) => void) | null = null

  constructor(
    app: App,
    private plugin: PMPlugin,
    private project: Project,
    task: Task | null,
    private parentId: string | null,
    private onSave: (task: Task) => void | Promise<void>,
    defaults?: Partial<Task>
  ) {
    super(app)
    if (task) {
      this.task = JSON.parse(JSON.stringify(task)) as Task
      this.isNew = false
      // Compute current parentId from tree if not explicitly provided
      if (parentId == null) {
        const flat = flattenTasks(project.tasks)
        const entry = flat.find((f) => f.task.id === task.id)
        this.parentId = entry?.parentId ?? null
      }
    } else {
      this.task = makeTask({
        status: getDefaultStatusId(plugin.settings.statuses),
        priority: 'medium',
        type: parentId ? 'subtask' : 'task',
        ...defaults
      })
      this.isNew = true
    }
    this.originalParentId = this.parentId
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('pm-task-modal')
    this.modalEl.addClass('pm-modal')
    this.render()
  }

  onClose(): void {
    if (
      this.plugin.settings.saveTaskOnClose &&
      !this.isNew &&
      !this.cancelled &&
      !this.saved &&
      this.task.title.trim()
    ) {
      const conflict = this.plugin.store.findTaskFileConflict(this.project, this.task)
      if (conflict) {
        new Notice(`Task not saved: a note named "${conflict.fileName}" already exists.`)
      } else {
        void this.persistTask()
      }
    }
    if (this.saveKeyHandler) {
      this.modalEl.removeEventListener('keydown', this.saveKeyHandler)
      this.saveKeyHandler = null
    }
    this.noteSuggest?.destroy()
    this.noteSuggest = null
    this.contentEl.empty()
  }

  private persistTask(): Promise<void> {
    if (this.persistPromise) return this.persistPromise
    const p = (async () => {
      try {
        await this.runPersist()
      } catch (err) {
        this.persistPromise = null
        throw err
      }
    })()
    this.persistPromise = p
    return p
  }

  private async insertAttachments(
    descArea: HTMLTextAreaElement,
    items: { blob: Blob; name: string }[],
    autoResize: () => void
  ): Promise<void> {
    for (const { blob, name } of items) {
      try {
        const buffer = await blob.arrayBuffer()
        const file = await this.plugin.store.saveTaskAttachment(this.project, this.task, name, buffer)
        const snippet = `![[${file.name}]]`
        descArea.setRangeText(snippet, descArea.selectionStart, descArea.selectionEnd, 'end')
        this.task.description = descArea.value
        autoResize()
      } catch (err) {
        console.error('Failed to save attachment', err)
        new Notice('Failed to save attachment')
      }
    }
  }

  private async runPersist(): Promise<void> {
    if (this.isNew) {
      await this.plugin.store.insertTask(this.project, this.task, this.parentId)
    } else if (this.parentId !== this.originalParentId) {
      await this.plugin.store.updateTask(this.project, this.task.id, this.task)
      await this.plugin.store.moveTask(this.project, this.task.id, this.parentId)
    } else {
      await this.plugin.store.updateTask(this.project, this.task.id, this.task)
    }
    if (this.plugin.settings.autoSchedule) {
      await this.plugin.store.scheduleAfterChange(this.project, this.task.id, this.plugin.settings.statuses)
    }
    await this.onSave(this.task)
  }

  private openOverflowMenu(anchorEl: HTMLElement): void {
    const menu = new Menu()
    if (this.task.filePath) {
      const filePath = this.task.filePath
      menu.addItem((item) =>
        item
          .setTitle('Open as note')
          .setIcon('file-text')
          .onClick(() => {
            this.saved = false
            this.cancelled = false
            this.close()
            void this.app.workspace.openLinkText(filePath, '', true)
          })
      )
      menu.addSeparator()
    }
    if (this.task.archived) {
      menu.addItem((item) =>
        item
          .setTitle('Unarchive')
          .setIcon('archive-restore')
          .onClick(
            safeAsync(async () => {
              await this.plugin.store.unarchiveTask(this.project, this.task.id)
              new Notice('Task unarchived')
              await this.onSave(this.task)
              this.cancelled = true
              this.close()
            })
          )
      )
    } else {
      menu.addItem((item) =>
        item
          .setTitle('Archive')
          .setIcon('archive')
          .onClick(
            safeAsync(async () => {
              await this.plugin.store.archiveTask(this.project, this.task.id)
              new Notice('Task archived')
              await this.onSave(this.task)
              this.cancelled = true
              this.close()
            })
          )
      )
    }
    menu.addItem((item) =>
      item
        .setTitle('Delete')
        .setIcon('trash-2')
        .setWarning(true)
        .onClick(
          safeAsync(async () => {
            if (await confirmDialog(this.app, `Delete "${this.task.title}"?`)) {
              await this.plugin.store.deleteTask(this.project, this.task.id)
              await this.onSave(this.task)
              this.cancelled = true
              this.close()
            }
          })
        )
    )
    const rect = anchorEl.getBoundingClientRect()
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 })
  }

  private render(): void {
    const { contentEl } = this
    contentEl.empty()

    // ── Header: breadcrumb · overflow · close ───────────────────────────────
    const header = contentEl.createDiv('pm-te-header')
    const prio = getPriorityConfig(this.plugin.settings.priorities, this.task.priority)
    if (prio?.color) header.setCssProps({ '--pm-accent-strip': prio.color })
    const crumb = header.createDiv('pm-te-crumb')
    if (this.project.icon) crumb.createSpan({ cls: 'pm-te-crumb-icon', text: this.project.icon })
    crumb.createSpan({ cls: 'pm-te-crumb-name', text: this.project.title })
    const crumbSep = crumb.createSpan({ cls: 'pm-te-crumb-sep' })
    setIcon(crumbSep, 'chevron-right')
    crumb.createSpan({ cls: 'pm-te-crumb-id', text: this.task.id })

    header.createDiv('pm-te-header-spacer')

    if (!this.isNew) {
      const moreBtn = new ExtraButtonComponent(header).setIcon('more-horizontal').setTooltip('More actions')
      moreBtn.extraSettingsEl.addClass('pm-te-header-btn')
      moreBtn.onClick(() => this.openOverflowMenu(moreBtn.extraSettingsEl))
    }
    const closeBtn = new ExtraButtonComponent(header).setIcon('x').setTooltip('Close')
    closeBtn.extraSettingsEl.addClass('pm-te-header-btn')
    closeBtn.onClick(() => {
      this.cancelled = true
      this.close()
    })

    // ── Body ────────────────────────────────────────────────────────────────
    const body = contentEl.createDiv('pm-te-body')

    // Title hero
    const titleWrap = body.createDiv('pm-te-title-wrap')
    const titleInput = titleWrap.createEl('textarea', { cls: 'pm-te-title' })
    titleInput.rows = 1
    titleInput.value = this.task.title
    titleInput.placeholder = 'Task title'
    titleInput.spellcheck = false
    const autosizeTitle = () => {
      titleInput.setCssProps({ '--te-title-height': 'auto' })
      titleInput.setCssProps({ '--te-title-height': titleInput.scrollHeight + 'px' })
    }
    const titleError = titleWrap.createDiv({ cls: 'pm-modal-title-error', attr: { hidden: '' } })
    const clearTitleError = () => {
      if (titleError.hasAttribute('hidden')) return
      titleError.setAttribute('hidden', '')
      titleError.setText('')
      titleInput.classList.remove('pm-input-error')
    }
    const showTitleError = (message: string) => {
      titleError.setText(message)
      titleError.removeAttribute('hidden')
      titleInput.classList.add('pm-input-error')
      titleInput.focus()
      titleInput.select()
    }
    titleInput.addEventListener('input', () => {
      this.task.title = titleInput.value
      clearTitleError()
      autosizeTitle()
    })
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) e.preventDefault()
    })
    window.setTimeout(autosizeTitle, 0)
    titleInput.focus()
    if (this.isNew) titleInput.select()

    // Properties
    const props = body.createDiv('pm-te-props')
    renderTaskFormFields(props, {
      task: this.task,
      project: this.project,
      plugin: this.plugin,
      parentId: this.parentId,
      setParentId: (id) => {
        this.parentId = id
      },
      rerender: () => this.render(),
      shownExtras: this.shownExtras
    })

    body.createEl('hr', { cls: 'pm-te-divider' })

    // ── Description (preview / edit) ─────────────────────────────────────────
    const descSection = body.createDiv('pm-modal-section pm-modal-desc-section')
    descSection.createEl('h4', { text: 'Description', cls: 'pm-modal-section-title' })

    const descPreview = descSection.createDiv('pm-modal-desc-preview')
    const descArea = descSection.createEl('textarea', { cls: 'pm-modal-description' })
    descArea.placeholder = 'Add a description…'
    descArea.value = this.task.description

    const autoResize = () => {
      const saved: [HTMLElement, number][] = []
      let ancestor = descArea.parentElement
      while (ancestor) {
        if (ancestor.scrollTop > 0) saved.push([ancestor, ancestor.scrollTop])
        ancestor = ancestor.parentElement
      }
      descArea.setCssProps({ '--desc-height': 'auto' })
      descArea.setCssProps({ '--desc-height': descArea.scrollHeight + 'px' })
      for (const [el, top] of saved) el.scrollTop = top
    }

    const hasContent = () => this.task.description.trim().length > 0
    const sourcePath = this.task.filePath || this.project.filePath || ''

    let descComp = new Component()
    descComp.load()

    const toggleCheckbox = (index: number) => {
      let count = 0
      this.task.description = this.task.description.replace(
        /^([ \t]*[-*+] \[)([ x])(\])/gm,
        (match, pre, state, post) => {
          if (count++ === index) return pre + (state === ' ' ? 'x' : ' ') + post
          return match
        }
      )
      descArea.value = this.task.description
      void renderPreview()
    }

    const attachCheckboxListeners = () => {
      descPreview.querySelectorAll('input[type="checkbox"]').forEach((el, i) => {
        const cb = el as HTMLInputElement
        cb.removeAttribute('disabled')
        cb.addEventListener('click', (e) => {
          e.preventDefault()
          toggleCheckbox(i)
        })
      })
    }

    // MarkdownRenderer emits external anchors with target="_blank"; Electron
    // silently drops file:// under that, so route file:// clicks through window.open.
    const attachFileLinkHandlers = () => {
      descPreview.querySelectorAll<HTMLAnchorElement>('a.external-link').forEach((a) => {
        if (!a.href.startsWith('file://')) return
        a.addEventListener('click', (e) => {
          e.preventDefault()
          activeWindow.open(a.href)
        })
      })
    }

    const renderPreview = async () => {
      descComp.unload()
      descComp = new Component()
      descComp.load()
      descPreview.empty()
      await MarkdownRenderer.render(this.app, this.task.description, descPreview, sourcePath, descComp)
      attachCheckboxListeners()
      attachFileLinkHandlers()
    }

    const showEdit = () => {
      descPreview.classList.add('pm-hidden')
      descArea.classList.remove('pm-hidden')
      descArea.value = this.task.description
      window.setTimeout(() => {
        autoResize()
        descArea.focus()
      }, 0)
    }

    const showPreview = () => {
      if (!hasContent()) return
      void renderPreview()
      descArea.classList.add('pm-hidden')
      descPreview.classList.remove('pm-hidden')
    }

    descArea.addEventListener('input', () => {
      this.task.description = descArea.value
      autoResize()
    })
    descArea.addEventListener('blur', () => showPreview())

    descArea.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items
      if (!items) return
      const attachments: { blob: Blob; name: string }[] = []
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            const stamp = new Date().toISOString().replace(/[:.]/g, '-')
            const sub = (item.type.split('/')[1] || 'png').split('+')[0]
            const ext = sub === 'jpeg' ? 'jpg' : sub
            attachments.push({ blob: file, name: `Pasted-${stamp}.${ext}` })
          }
        }
      }
      if (attachments.length === 0) return
      e.preventDefault()
      void this.insertAttachments(descArea, attachments, autoResize)
    })

    descSection.addEventListener('dragover', (e) => {
      if (!e.dataTransfer) return
      if (!Array.from(e.dataTransfer.types).includes('Files')) return
      e.preventDefault()
    })

    descSection.addEventListener('drop', (e) => {
      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return
      e.preventDefault()
      if (descArea.classList.contains('pm-hidden')) {
        showEdit()
        descArea.selectionStart = descArea.selectionEnd = descArea.value.length
      }
      const attachments = Array.from(files).map((f) => ({ blob: f, name: f.name }))
      void this.insertAttachments(descArea, attachments, autoResize)
    })

    // Note link suggest (inline [[ autocomplete)
    this.noteSuggest?.destroy()
    this.noteSuggest = new NoteLinkSuggest(this.app, descArea, (newValue) => {
      this.task.description = newValue
      autoResize()
    })
    this.noteSuggest.attach(descSection)

    descPreview.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      if (target.instanceOf(HTMLInputElement) && target.type === 'checkbox') return

      const link = target.closest('a')

      if (link) {
        // Internal link (Obsidian note link)
        if (link.classList.contains('internal-link')) {
          e.preventDefault()
          e.stopPropagation()
          const href = link.getAttribute('data-href') || link.getAttribute('href') || ''
          this.saved = false
          this.cancelled = false
          this.close()
          void this.app.workspace.openLinkText(href, sourcePath)
          return
        }
        // External link - let browser handle it
        return
      }

      // Click on non-link text = edit
      showEdit()
    })

    if (hasContent()) {
      descArea.classList.add('pm-hidden')
      void renderPreview()
    } else {
      descPreview.classList.add('pm-hidden')
      window.setTimeout(autoResize, 0)
    }

    // ── Subtasks ────────────────────────────────────────────────────────────
    renderSubtasksPanel(body, this.task, this.plugin)

    // ── Time tracking ─────────────────────────────────────────────────────────
    renderTimeTrackingPanel(body, this.task)

    // ── Footer ──────────────────────────────────────────────────────────────
    const footer = contentEl.createDiv('pm-te-footer')

    if (!this.isNew && this.task.filePath) {
      const pathHint = footer.createSpan({ cls: 'pm-te-footer-path' })
      const fileIcon = pathHint.createSpan({ cls: 'pm-te-footer-icon' })
      setIcon(fileIcon, 'file-text')
      pathHint.createSpan({ text: this.task.filePath })
    }

    footer.createDiv('pm-footer-spacer')

    new ButtonComponent(footer).setButtonText('Cancel').onClick(() => {
      this.cancelled = true
      this.close()
    })

    const saveBtn = new ButtonComponent(footer)
      .setButtonText(this.isNew ? 'Create (Shift+Enter)' : 'Save (Shift+Enter)')
      .setCta()
    let saving = false
    const doSave = async () => {
      if (saving) return
      saving = true
      try {
        if (!this.task.title.trim()) {
          titleInput.focus()
          titleInput.classList.add('pm-input-error')
          return
        }
        clearTitleError()
        await this.persistTask()
        this.saved = true
        this.close()
      } catch (err) {
        if (err instanceof TaskFileNameConflictError) {
          showTitleError(`A note named "${err.fileName}" already exists. Choose a different title.`)
          return
        }
        console.error('[PM]', err)
        new Notice('Something went wrong. Check the console for details.')
      } finally {
        saving = false
      }
    }

    saveBtn.onClick(() => {
      void doSave()
    })

    if (this.saveKeyHandler) this.modalEl.removeEventListener('keydown', this.saveKeyHandler)
    this.saveKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault()
        void doSave()
      }
    }
    this.modalEl.addEventListener('keydown', this.saveKeyHandler)
  }
}

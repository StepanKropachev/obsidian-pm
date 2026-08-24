import { App, ButtonComponent, ExtraButtonComponent, Modal, setIcon } from 'obsidian'
import type PMPlugin from '../main'
import { DEFAULT_PROJECT_COLOR, DEFAULT_PROJECT_ICON } from '../types'
import { projectFilePath } from '../store'
import { safeAsync } from '../utils'
import { promptText } from '../ui/ModalFactory'
import { renderAddButton } from '../ui/composites/addButton'
import { renderChipList, renderPropRow } from '../ui/FormField'
import { renderIconControl, renderSelectControl } from '../ui/composites/properties'

interface Draft {
  title: string
  icon: string
  color: string
  parentPath: string
  teamMembers: string[]
  description: string
}

/** Everything a project needs to exist, asked once. Nothing is written until Create. */
export class ProjectCreateModal extends Modal {
  private draft: Draft = {
    title: '',
    icon: DEFAULT_PROJECT_ICON,
    color: DEFAULT_PROJECT_COLOR,
    parentPath: '',
    teamMembers: [],
    description: ''
  }
  private header!: HTMLElement
  private titleInput!: HTMLTextAreaElement
  private titleError!: HTMLElement
  private pathHint!: HTMLElement
  private iconHost!: HTMLElement
  private submit!: ButtonComponent

  constructor(
    app: App,
    private plugin: PMPlugin
  ) {
    super(app)
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('pm-te-modal', 'pm-te-surface')
    this.modalEl.addClass('pm-modal', 'pm-modal--create')

    this.renderHeader(contentEl)

    const body = contentEl.createDiv('pm-te-body')
    this.renderTitle(body)

    const grid = body.createDiv('pm-te-props').createDiv('pm-prop-grid')
    this.renderIcon(grid)
    this.renderColor(grid)
    this.renderParent(grid)
    this.renderMembers(grid)

    body.createEl('hr', { cls: 'pm-te-divider' })
    this.renderDescription(body)

    this.renderFooter(contentEl)

    this.modalEl.addEventListener('keydown', this.handleKeyDown)
    this.refreshValidity()
  }

  onClose(): void {
    this.modalEl.removeEventListener('keydown', this.handleKeyDown)
    this.contentEl.empty()
  }

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      this.create()
    }
  }

  private renderHeader(parent: HTMLElement): void {
    this.header = parent.createDiv('pm-te-header')
    this.paintAccent()
    const crumb = this.header.createDiv('pm-te-crumb')
    const folderIcon = crumb.createSpan({ cls: 'pm-te-crumb-icon' })
    setIcon(folderIcon, 'folder')
    crumb.createSpan({ cls: 'pm-te-crumb-name', text: this.plugin.settings.projectsFolder || this.app.vault.getName() })
    const sep = crumb.createSpan({ cls: 'pm-te-crumb-sep' })
    setIcon(sep, 'chevron-right')
    crumb.createSpan({ text: 'New project' })

    this.header.createDiv('pm-te-header-spacer')

    const closeBtn = new ExtraButtonComponent(this.header).setIcon('x').setTooltip('Close')
    closeBtn.extraSettingsEl.addClass('pm-te-header-btn')
    closeBtn.onClick(() => this.close())
  }

  private paintAccent(): void {
    this.header.setCssProps({ '--pm-accent-strip': this.draft.color })
  }

  private renderTitle(parent: HTMLElement): void {
    const wrap = parent.createDiv('pm-te-title-wrap')
    this.titleInput = wrap.createEl('textarea', { cls: 'pm-te-title' })
    this.titleInput.rows = 1
    this.titleInput.placeholder = 'Project name'
    this.titleInput.spellcheck = false
    this.titleError = wrap.createDiv({ cls: 'pm-modal-title-error', attr: { hidden: '' } })

    const autosize = () => {
      this.titleInput.setCssProps({ '--te-title-height': 'auto' })
      this.titleInput.setCssProps({ '--te-title-height': this.titleInput.scrollHeight + 'px' })
    }
    this.titleInput.addEventListener('input', () => {
      this.draft.title = this.titleInput.value
      autosize()
      this.refreshValidity()
    })
    this.titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        this.create()
      }
    })
    window.setTimeout(autosize, 0)
    this.titleInput.focus()
  }

  private renderIcon(parent: HTMLElement): void {
    renderPropRow(
      parent,
      'Icon',
      () => {
        this.iconHost = createDiv('pm-prop-value')
        this.drawIcon()
        return this.iconHost
      },
      'smile'
    )
  }

  private drawIcon(): void {
    this.iconHost.empty()
    renderIconControl({
      container: this.iconHost,
      value: this.draft.icon,
      color: this.draft.color,
      onChange: (icon) => {
        this.draft.icon = icon
      }
    })
  }

  private renderColor(parent: HTMLElement): void {
    renderPropRow(
      parent,
      'Color',
      () => {
        const cell = createDiv('pm-prop-value pm-prop-color')
        const picker = cell.createEl('input', { type: 'color', cls: 'pm-color-custom' })
        picker.value = this.draft.color
        picker.addEventListener('change', () => {
          this.draft.color = picker.value
          this.paintAccent()
          this.drawIcon()
        })
        return cell
      },
      'palette'
    )
  }

  private renderParent(parent: HTMLElement): void {
    renderPropRow(
      parent,
      'Parent',
      () => {
        const cell = createDiv('pm-prop-value')
        const draw = (): void => {
          cell.empty()
          renderSelectControl({
            container: cell,
            value: this.draft.parentPath,
            placeholder: 'No parent',
            search: true,
            options: [
              { id: '', label: 'No parent' },
              ...this.plugin.index.projectRefs().map((ref) => ({ id: ref.path, label: ref.title, color: ref.color }))
            ],
            onChange: (path) => {
              this.draft.parentPath = path
              draw()
            }
          })
        }
        draw()
        return cell
      },
      'corner-up-right'
    )
  }

  private renderMembers(parent: HTMLElement): void {
    const row = renderPropRow(
      parent,
      'Members',
      () => {
        const list = createDiv('pm-prop-value')
        const draw = (): void => {
          renderChipList(list, this.draft.teamMembers, {
            variant: 'accent',
            onRemove: (member) => {
              this.draft.teamMembers = this.draft.teamMembers.filter((name) => name !== member)
              draw()
            },
            renderAdd: (container) => {
              renderAddButton(
                container,
                'Add member',
                safeAsync(async () => {
                  const name = await promptText(this.app, 'Member name', 'Name')
                  if (!name || this.draft.teamMembers.includes(name)) return
                  this.draft.teamMembers.push(name)
                  draw()
                })
              )
            }
          })
        }
        draw()
        return list
      },
      'users'
    )
    row.addClass('pm-prop-row--wide')
  }

  private renderDescription(parent: HTMLElement): void {
    const section = parent.createDiv('pm-modal-section pm-modal-desc-section')
    section.createEl('h4', { text: 'Description', cls: 'pm-modal-section-title' })
    const area = section.createEl('textarea', { cls: 'pm-modal-description' })
    area.placeholder = 'What this project covers and what done looks like'
    const autoResize = () => {
      area.setCssProps({ '--desc-height': 'auto' })
      area.setCssProps({ '--desc-height': area.scrollHeight + 'px' })
    }
    area.addEventListener('input', () => {
      this.draft.description = area.value
      autoResize()
    })
    window.setTimeout(autoResize, 0)
  }

  private renderFooter(parent: HTMLElement): void {
    const footer = parent.createDiv('pm-te-footer')
    this.pathHint = footer.createSpan({ cls: 'pm-te-footer-path' })
    const fileIcon = this.pathHint.createSpan({ cls: 'pm-te-footer-icon' })
    setIcon(fileIcon, 'file-text')
    this.pathHint.createSpan()

    footer.createDiv('pm-footer-spacer')

    new ButtonComponent(footer).setButtonText('Cancel').onClick(() => this.close())
    this.submit = new ButtonComponent(footer)
      .setButtonText('Create project (Shift+Enter)')
      .setCta()
      .onClick(() => this.create())
  }

  private refreshValidity(): void {
    const title = this.draft.title.trim()
    const path = title ? this.targetPath(title) : ''
    const taken = !!path && !!this.app.vault.getAbstractFileByPath(path)

    this.pathHint.lastElementChild?.setText(path)
    this.pathHint.toggleClass('pm-hidden', !path)
    if (taken) {
      this.titleError.setText('A note with this name is already there.')
      this.titleError.removeAttribute('hidden')
      this.titleInput.addClass('pm-input-error')
    } else {
      this.titleError.setText('')
      this.titleError.setAttribute('hidden', '')
      this.titleInput.removeClass('pm-input-error')
    }
    this.submit.setDisabled(!title || taken)
  }

  private targetPath(title: string): string {
    return projectFilePath(title, this.plugin.settings.projectsFolder)
  }

  private readonly create = safeAsync(async () => {
    const title = this.draft.title.trim()
    if (!title || this.app.vault.getAbstractFileByPath(this.targetPath(title))) return
    const project = await this.plugin.store.createProject(title, this.plugin.settings.projectsFolder, {
      icon: this.draft.icon,
      color: this.draft.color,
      description: this.draft.description,
      teamMembers: this.draft.teamMembers,
      parentPath: this.draft.parentPath || undefined
    })
    this.close()
    await this.plugin.router.openProjectLink(project.filePath)
  })
}

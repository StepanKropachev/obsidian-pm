import { App, ButtonComponent, Modal } from 'obsidian'
import type PMPlugin from '../main'
import { DEFAULT_PROJECT_COLOR, DEFAULT_PROJECT_ICON } from '../types'
import { projectFilePath } from '../store'
import { safeAsync } from '../utils'
import { promptText } from '../ui/ModalFactory'
import { renderAddButton } from '../ui/composites/addButton'
import { renderChipList } from '../ui/FormField'
import { renderIconControl, renderSelectControl } from '../ui/composites/properties'

interface Draft {
  title: string
  icon: string
  color: string
  parentPath: string
  teamMembers: string[]
  description: string
}

/**
 * Everything a project needs to exist, asked once. Nothing is written until Create, and the
 * settings page takes over for everything this form leaves out.
 */
export class ProjectCreateModal extends Modal {
  private draft: Draft = {
    title: '',
    icon: DEFAULT_PROJECT_ICON,
    color: DEFAULT_PROJECT_COLOR,
    parentPath: '',
    teamMembers: [],
    description: ''
  }
  private notice!: HTMLElement
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
    contentEl.addClass('pm-create')
    this.modalEl.addClass('pm-modal', 'pm-modal--create')
    this.setTitle('New project')

    this.renderName(contentEl)
    const grid = contentEl.createDiv('pm-create-grid')
    this.renderIcon(grid)
    this.renderColor(grid)
    this.renderParent(contentEl)
    this.renderMembers(contentEl)
    this.renderDescription(contentEl)

    const buttons = contentEl.createDiv('pm-modal-btn-row')
    new ButtonComponent(buttons).setButtonText('Cancel').onClick(() => this.close())
    this.submit = new ButtonComponent(buttons)
      .setButtonText('Create project')
      .setCta()
      .onClick(() => this.create())
    this.refreshValidity()
  }

  onClose(): void {
    this.contentEl.empty()
  }

  private renderName(parent: HTMLElement): void {
    const block = parent.createDiv('pm-create-block')
    block.createEl('label', { text: 'Name', cls: 'pm-label' })
    const input = block.createEl('input', { type: 'text', cls: 'pm-input' })
    input.placeholder = 'Project name'
    input.addEventListener('input', () => {
      this.draft.title = input.value
      this.refreshValidity()
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.create()
      }
    })
    this.notice = block.createDiv({ cls: 'pm-create-notice' })
    window.setTimeout(() => input.focus(), 10)
  }

  private renderIcon(parent: HTMLElement): void {
    const block = parent.createDiv('pm-create-block')
    block.createEl('label', { text: 'Icon', cls: 'pm-label' })
    this.iconHost = block.createDiv()
    this.drawIcon()
  }

  /** Redrawn on a color change, so the preview keeps the tint the icon will have. */
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
    const block = parent.createDiv('pm-create-block')
    block.createEl('label', { text: 'Color', cls: 'pm-label' })
    const field = block.createEl('input', { type: 'color', cls: 'pm-color-custom' })
    field.value = this.draft.color
    field.addEventListener('change', () => {
      this.draft.color = field.value
      this.drawIcon()
    })
  }

  private renderParent(parent: HTMLElement): void {
    const block = parent.createDiv('pm-create-block')
    block.createEl('label', { text: 'Parent', cls: 'pm-label' })
    const cell = block.createDiv('pm-prop-value')
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
  }

  private renderMembers(parent: HTMLElement): void {
    const block = parent.createDiv('pm-create-block')
    block.createEl('label', { text: 'Members', cls: 'pm-label' })
    const list = block.createDiv('pm-prop-value')
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
  }

  private renderDescription(parent: HTMLElement): void {
    const block = parent.createDiv('pm-create-block')
    block.createEl('label', { text: 'Description', cls: 'pm-label' })
    const area = block.createEl('textarea', { cls: 'pm-input pm-edit-desc' })
    area.placeholder = 'What this project covers and what done looks like'
    area.addEventListener('input', () => {
      this.draft.description = area.value
    })
  }

  /** The name decides the file name, so a note already sitting there blocks the create. */
  private refreshValidity(): void {
    const title = this.draft.title.trim()
    const taken = !!title && !!this.app.vault.getAbstractFileByPath(this.targetPath(title))
    this.notice.setText(taken ? 'A note with this name is already there.' : '')
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
    await this.plugin.router.openProjectOverview(project.filePath)
  })
}

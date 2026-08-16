import { ButtonComponent, ItemView, WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '../main'
import { projectFilePath } from '../store'
import { safeAsync } from '../utils'
import { promptText } from '../ui/ModalFactory'
import { renderAddButton } from '../ui/composites/addButton'
import { renderChipList } from '../ui/FormField'
import { renderSelectControl } from '../ui/composites/properties'
import { PROJECT_COLORS, PROJECT_ICONS } from './ProjectEditView'

export const PM_PROJECT_CREATE_VIEW_TYPE = 'pm-project-create'

interface Draft {
  title: string
  icon: string
  color: string
  parentPath: string
  teamMembers: string[]
  description: string
}

/**
 * A new project, as a page of its own. Nothing is written until Create: the draft lives
 * here, and the settings page takes over for everything this form leaves out.
 */
export class ProjectCreateView extends ItemView {
  plugin: PMPlugin
  private draft: Draft = {
    title: '',
    icon: '📋',
    color: PROJECT_COLORS[0],
    parentPath: '',
    teamMembers: [],
    description: ''
  }
  private container!: HTMLElement
  private tile!: HTMLElement
  private notice!: HTMLElement
  private submit!: ButtonComponent

  constructor(leaf: WorkspaceLeaf, plugin: PMPlugin) {
    super(leaf)
    this.plugin = plugin
    this.navigation = false
  }

  getViewType(): string {
    return PM_PROJECT_CREATE_VIEW_TYPE
  }
  getDisplayText(): string {
    return 'New project'
  }
  getIcon(): string {
    return 'folder-plus'
  }

  onOpen(): Promise<void> {
    this.containerEl.addClass('pm-view')
    this.contentEl.empty()
    this.contentEl.addClass('pm-root')
    this.container = this.contentEl.createDiv('pm-edit pm-create')
    this.render()
    return Promise.resolve()
  }

  onClose(): Promise<void> {
    this.contentEl.empty()
    return Promise.resolve()
  }

  private render(): void {
    this.renderHeader()
    const section = this.container.createDiv('pm-edit-section')
    this.renderName(section)
    const grid = section.createDiv('pm-create-grid')
    this.renderIcons(grid)
    this.renderColors(grid)
    this.renderParent(section)
    this.renderMembers(section)
    this.renderDescription(section)
    this.renderActions()
    this.refreshValidity()
  }

  private renderHeader(): void {
    const header = this.container.createDiv('pm-edit-header')
    this.tile = header.createDiv({ cls: 'pm-overview-icon', text: this.draft.icon })
    this.tile.style.setProperty('--pm-overview-tint', this.draft.color)
    const identity = header.createDiv('pm-overview-identity')
    identity.createDiv({ cls: 'pm-overview-title', text: 'New project' })
    const folder = this.plugin.settings.projectsFolder
    identity.createDiv({ cls: 'pm-overview-subline', text: `Created in ${folder || 'the vault root'}` })
  }

  private renderName(parent: HTMLElement): void {
    const block = parent.createDiv('pm-edit-block')
    block.createEl('label', { text: 'Name', cls: 'pm-label' })
    const input = block.createEl('input', { type: 'text', cls: 'pm-input' })
    input.placeholder = 'Project name'
    input.addEventListener('input', () => {
      this.draft.title = input.value
      this.refreshValidity()
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.create()
    })
    this.notice = block.createDiv({ cls: 'pm-create-notice' })
    input.focus()
  }

  private renderIcons(parent: HTMLElement): void {
    const block = parent.createDiv('pm-edit-block')
    block.createEl('label', { text: 'Icon', cls: 'pm-label' })
    const row = block.createDiv('pm-edit-icons')
    const buttons: HTMLElement[] = []
    for (const emoji of PROJECT_ICONS) {
      const btn = row.createEl('button', { text: emoji, cls: 'pm-icon-option' })
      btn.toggleClass('pm-icon-option--selected', emoji === this.draft.icon)
      btn.addEventListener('click', () => {
        this.draft.icon = emoji
        this.tile.setText(emoji)
        for (const other of buttons) other.toggleClass('pm-icon-option--selected', other === btn)
      })
      buttons.push(btn)
    }
  }

  private renderColors(parent: HTMLElement): void {
    const block = parent.createDiv('pm-edit-block')
    block.createEl('label', { text: 'Color', cls: 'pm-label' })
    const row = block.createDiv('pm-color-palette')
    const swatches: HTMLElement[] = []
    const pick = (color: string, chosen: HTMLElement | null): void => {
      this.draft.color = color
      this.tile.style.setProperty('--pm-overview-tint', color)
      for (const swatch of swatches) swatch.toggleClass('pm-color-swatch--selected', swatch === chosen)
    }
    for (const color of PROJECT_COLORS) {
      const swatch = row.createEl('button', { cls: 'pm-color-swatch' })
      swatch.setCssStyles({ background: color })
      swatch.toggleClass('pm-color-swatch--selected', color === this.draft.color)
      swatch.addEventListener('click', () => pick(color, swatch))
      swatches.push(swatch)
    }
    const custom = row.createEl('input', { type: 'color', cls: 'pm-color-custom' })
    custom.value = this.draft.color
    custom.title = 'Custom color'
    custom.addEventListener('change', () => pick(custom.value, null))
  }

  private renderParent(parent: HTMLElement): void {
    const block = parent.createDiv('pm-edit-block')
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
    const block = parent.createDiv('pm-edit-block')
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
    const block = parent.createDiv('pm-edit-block')
    block.createEl('label', { text: 'Description', cls: 'pm-label' })
    const area = block.createEl('textarea', { cls: 'pm-input pm-edit-desc' })
    area.placeholder = 'What this project covers and what done looks like'
    area.addEventListener('input', () => {
      this.draft.description = area.value
    })
  }

  private renderActions(): void {
    const actions = this.container.createDiv('pm-create-actions')
    new ButtonComponent(actions).setButtonText('Cancel').onClick(() => this.leaf.detach())
    this.submit = new ButtonComponent(actions)
      .setButtonText('Create project')
      .setCta()
      .onClick(() => this.create())
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
    await this.plugin.router.openProjectOverview(project.filePath, this.leaf)
  })
}

import { ButtonComponent, ItemView, TFile, WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '../main'
import {
  type CustomFieldDef,
  type PriorityConfig,
  type Project,
  type ProjectConfig,
  type ProjectPatch,
  type StatusConfig,
  makeId
} from '../types'
import { safeAsync, truncateTitle } from '../utils'
import { confirmDialog, promptText } from '../ui/ModalFactory'
import { renderAddButton } from '../ui/composites/addButton'
import { renderChipList, renderPropRow } from '../ui/FormField'
import { renderIconControl, renderInputControl, renderSelectControl } from '../ui/composites/properties'
import { renderPriorityListEditor, renderStatusListEditor } from '../ui/PaletteListEditor'
import { EmptyState } from '../ui/primitives/EmptyState'
import { IconButton } from '../ui/primitives/IconButton'

export const PM_PROJECT_EDIT_VIEW_TYPE = 'pm-project-edit'

export interface ProjectEditState {
  filePath?: string
  [key: string]: unknown
}

const FIELD_TYPES: { id: CustomFieldDef['type']; label: string }[] = [
  { id: 'text', label: 'Text' },
  { id: 'number', label: 'Number' },
  { id: 'date', label: 'Date' },
  { id: 'select', label: 'Select' },
  { id: 'multiselect', label: 'Multi-select' },
  { id: 'person', label: 'Person' },
  { id: 'checkbox', label: 'Checkbox' },
  { id: 'url', label: 'URL' }
]

export class ProjectEditView extends ItemView {
  plugin: PMPlugin
  private state: ProjectEditState = {}
  private project: Project | null = null
  private container!: HTMLElement

  constructor(leaf: WorkspaceLeaf, plugin: PMPlugin) {
    super(leaf)
    this.plugin = plugin
    this.navigation = false
  }

  getViewType(): string {
    return PM_PROJECT_EDIT_VIEW_TYPE
  }
  getDisplayText(): string {
    return truncateTitle(this.project?.title ?? 'Project', 10)
  }
  getIcon(): string {
    return 'settings'
  }

  async setState(state: ProjectEditState, result: unknown): Promise<void> {
    const changed = state.filePath !== this.state.filePath
    this.state = state
    if (changed || !this.project) await this.loadProject()
    await super.setState(state, result as import('obsidian').ViewStateResult)
  }

  getState(): ProjectEditState {
    return this.state
  }

  onOpen(): Promise<void> {
    this.containerEl.addClass('pm-view')
    this.contentEl.empty()
    this.contentEl.addClass('pm-root')
    this.container = this.contentEl.createDiv('pm-edit')
    return Promise.resolve()
  }

  onClose(): Promise<void> {
    this.contentEl.empty()
    return Promise.resolve()
  }

  private async loadProject(): Promise<void> {
    const path = this.state.filePath
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null
    this.project = file instanceof TFile ? await this.plugin.store.loadProject(file) : null
    if (!this.project) {
      this.container.empty()
      new EmptyState(this.container)
        .setIcon('📋')
        .setTitle('No project here')
        .setBody('It may have been deleted or renamed.')
      return
    }
    await this.plugin.store.loadProjectBody(this.project)
    ;(this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.()
    this.render()
  }

  private readonly save = safeAsync(async (patch: ProjectPatch) => {
    if (this.project) await this.plugin.store.updateProject(this.project, patch)
  })

  /** Sets or clears one override; the config goes away entirely when its last field clears. */
  private patchConfig<K extends keyof ProjectConfig>(key: K, value: ProjectConfig[K] | undefined): void {
    const entries = Object.entries({ ...this.project?.config, [key]: value }).filter(([, v]) => v !== undefined)
    this.save({ config: entries.length ? Object.fromEntries(entries) : undefined })
  }

  private section(title: string, hint = ''): HTMLElement {
    const section = this.container.createDiv('pm-edit-section')
    section.createDiv({ cls: 'pm-section-label', text: title })
    if (hint) section.createDiv({ cls: 'pm-modal-hint', text: hint })
    return section
  }

  render(): void {
    const project = this.project
    if (!project) return
    this.container.empty()

    this.renderHeader(project)
    this.renderGeneral(project)
    this.renderMembers(project)
    this.renderStatuses(project)
    this.renderPriorities(project)
    this.renderBehavior(project)
    this.renderCustomFields(project)
    this.renderDangerZone(project)
  }

  private renderHeader(project: Project): void {
    const header = this.container.createDiv('pm-edit-header')
    const tile = header.createDiv({ cls: 'pm-overview-icon', text: project.icon })
    tile.style.setProperty('--pm-overview-tint', project.color)
    const identity = header.createDiv('pm-overview-identity')
    identity.createDiv({ cls: 'pm-overview-title', text: project.title })
    identity.createDiv({ cls: 'pm-overview-subline', text: 'Project settings' })
    new ButtonComponent(header)
      .setButtonText('Done')
      .setCta()
      .onClick(safeAsync(() => this.plugin.router.openProjectOverview(project.filePath, this.leaf)))
  }

  private renderGeneral(project: Project): void {
    const section = this.section('General')
    const props = section.createDiv('pm-edit-props')

    renderPropRow(props, 'Name', () => {
      const cell = createDiv('pm-prop-value')
      renderInputControl({
        container: cell,
        value: project.title,
        placeholder: 'Project name',
        onChange: (value) => {
          const title = value.trim()
          if (!title || title === project.title) return
          this.save({ title })
          this.render()
        }
      })
      return cell
    })

    renderPropRow(props, 'Icon', () => {
      const cell = createDiv('pm-prop-value')
      renderIconControl({
        container: cell,
        value: project.icon,
        color: project.color,
        onChange: (icon) => {
          this.save({ icon })
          this.render()
        }
      })
      return cell
    })

    renderPropRow(props, 'Color', () => {
      const cell = createDiv('pm-prop-value')
      const picker = cell.createEl('input', { type: 'color', cls: 'pm-color-custom' })
      picker.value = project.color
      picker.title = 'Project color'
      picker.addEventListener('change', () => {
        this.save({ color: picker.value })
        this.render()
      })
      return cell
    })

    renderPropRow(props, 'Parent', () => {
      const cell = createDiv('pm-prop-value')
      const excluded = new Set([
        project.filePath,
        ...this.plugin.index.descendantRefs(project.filePath).map((ref) => ref.path)
      ])
      renderSelectControl({
        container: cell,
        value: project.parentPath ?? '',
        placeholder: 'No parent',
        search: true,
        options: [
          { id: '', label: 'No parent' },
          ...this.plugin.index
            .projectRefs()
            .filter((ref) => !excluded.has(ref.path))
            .map((ref) => ({ id: ref.path, label: ref.title, color: ref.color }))
        ],
        onChange: (path) => {
          this.save({ parentPath: path || undefined })
          this.render()
        }
      })
      return cell
    })

    const desc = section.createDiv('pm-edit-block')
    desc.createEl('label', { text: 'Description', cls: 'pm-label' })
    const area = desc.createEl('textarea', { cls: 'pm-input pm-edit-desc' })
    area.placeholder = 'What is this project about?'
    area.value = project.description
    area.addEventListener('change', () => {
      this.save({ description: area.value })
    })
  }

  private renderMembers(project: Project): void {
    const section = this.section('Members', 'Who is on this project')
    const list = section.createDiv('pm-prop-value')
    const draw = (): void => {
      renderChipList(list, project.teamMembers, {
        variant: 'accent',
        onRemove: (member) => {
          this.save({ teamMembers: project.teamMembers.filter((name) => name !== member) })
          draw()
        },
        renderAdd: (container) => {
          renderAddButton(
            container,
            'Add member',
            safeAsync(async () => {
              const name = await promptText(this.app, 'Member name', 'Name')
              if (!name || project.teamMembers.includes(name)) return
              this.save({ teamMembers: [...project.teamMembers, name] })
              draw()
            })
          )
        }
      })
    }
    draw()
  }

  private renderStatuses(project: Project): void {
    this.renderPaletteOverride<StatusConfig>({
      heading: 'Statuses',
      hint: 'The workflow for this project',
      toggleLabel: 'Use custom statuses instead of the global ones',
      addLabel: 'Add status',
      get: () => project.config?.statuses,
      set: (statuses) => this.patchConfig('statuses', statuses),
      copyGlobal: () => this.plugin.settings.statuses.map((status) => ({ ...status })),
      makeEntry: () => ({
        id: 'status-' + makeId().slice(0, 6),
        label: 'New status',
        color: '#8a94a0',
        icon: '',
        complete: false
      }),
      renderEditor: (container, statuses) =>
        renderStatusListEditor(container, {
          statuses,
          onChanged: () => this.save({ config: project.config })
        })
    })
  }

  private renderPriorities(project: Project): void {
    this.renderPaletteOverride<PriorityConfig>({
      heading: 'Priorities',
      hint: 'The priority scale for this project',
      toggleLabel: 'Use custom priorities instead of the global ones',
      addLabel: 'Add priority',
      get: () => project.config?.priorities,
      set: (priorities) => this.patchConfig('priorities', priorities),
      copyGlobal: () => this.plugin.settings.priorities.map((priority) => ({ ...priority })),
      makeEntry: () => ({ id: 'priority-' + makeId().slice(0, 6), label: 'New priority', color: '#8a94a0', icon: '' }),
      renderEditor: (container, priorities) =>
        renderPriorityListEditor(container, {
          priorities,
          onChanged: () => this.save({ config: project.config })
        })
    })
  }

  private renderPaletteOverride<T>(opts: {
    heading: string
    hint: string
    toggleLabel: string
    addLabel: string
    get: () => T[] | undefined
    set: (items: T[] | undefined) => void
    copyGlobal: () => T[]
    makeEntry: () => T
    renderEditor: (container: HTMLElement, items: T[]) => void
  }): void {
    const section = this.section(opts.heading, opts.hint)
    const toggle = section.createEl('label', { cls: 'pm-status-toggle' })
    const checkbox = toggle.createEl('input', { type: 'checkbox' })
    checkbox.checked = !!opts.get()?.length
    toggle.createSpan({ text: opts.toggleLabel })

    const editor = section.createDiv('pm-settings-statuses')
    const footer = section.createDiv()
    const drawEditor = (): void => {
      editor.empty()
      footer.empty()
      const own = opts.get()
      if (!own?.length) return
      opts.renderEditor(editor, own)
      renderAddButton(footer, opts.addLabel, () => {
        own.push(opts.makeEntry())
        opts.set(own)
        drawEditor()
      })
    }
    checkbox.addEventListener('change', () => {
      opts.set(checkbox.checked ? opts.copyGlobal() : undefined)
      drawEditor()
    })
    drawEditor()
  }

  private renderBehavior(project: Project): void {
    const section = this.section('View and scheduling', 'Overrides for this project')
    const props = section.createDiv('pm-edit-props')
    const row = <K extends keyof ProjectConfig>(
      label: string,
      key: K,
      options: { value: NonNullable<ProjectConfig[K]>; label: string }[]
    ): void => {
      renderPropRow(props, label, () => {
        const cell = createDiv('pm-prop-value')
        const current = project.config?.[key]
        renderSelectControl({
          container: cell,
          value: current === undefined ? 'inherit' : String(options.findIndex((o) => o.value === current)),
          options: [
            { id: 'inherit', label: 'Use global' },
            ...options.map((option, i) => ({ id: String(i), label: option.label }))
          ],
          onChange: (id) => {
            this.patchConfig(key, id === 'inherit' ? undefined : options[Number(id)].value)
            this.render()
          }
        })
        return cell
      })
    }

    row('Default view', 'defaultView', [
      { value: 'table', label: 'Table' },
      { value: 'gantt', label: 'Gantt' },
      { value: 'kanban', label: 'Board' }
    ])
    row('Auto-schedule', 'autoSchedule', [
      { value: true, label: 'On' },
      { value: false, label: 'Off' }
    ])
    row('Pull forward on early finish', 'pullForwardOnEarlyFinish', [
      { value: true, label: 'On' },
      { value: false, label: 'Off' }
    ])
    row('Subtree connections in table', 'showSubtreeConnections', [
      { value: true, label: 'Show' },
      { value: false, label: 'Hide' }
    ])
    row('Line borders in table', 'lineBorders', [
      { value: 'none', label: 'None' },
      { value: 'horizontal', label: 'Horizontal' },
      { value: 'vertical', label: 'Vertical' },
      { value: 'both', label: 'Both' }
    ])
    row('Subtasks on board', 'kanbanShowSubtasks', [
      { value: true, label: 'Show' },
      { value: false, label: 'Hide' }
    ])
    row('Description preview on board', 'kanbanShowDescriptionPreview', [
      { value: true, label: 'Show' },
      { value: false, label: 'Hide' }
    ])
  }

  private renderCustomFields(project: Project): void {
    const section = this.section('Custom fields', 'Extra properties for tasks')
    const list = section.createDiv('pm-cf-list')
    const draw = (): void => {
      list.empty()
      project.customFields.forEach((field, index) => this.renderCustomField(list, field, index, draw))
      renderAddButton(list, 'Add custom field', () => {
        project.customFields.push({ id: makeId(), name: 'New field', type: 'text', options: [] })
        this.save({ customFields: project.customFields })
        draw()
      })
    }
    draw()
  }

  private renderCustomField(container: HTMLElement, field: CustomFieldDef, index: number, redraw: () => void): void {
    const project = this.project
    if (!project) return
    const row = container.createDiv('pm-cf-row')

    const name = row.createEl('input', { type: 'text', value: field.name, cls: 'pm-input pm-cf-name' })
    name.placeholder = 'Field name'
    name.addEventListener('change', () => {
      field.name = name.value
      this.save({ customFields: project.customFields })
    })

    const type = row.createEl('select', { cls: 'pm-input pm-select pm-cf-type' })
    for (const option of FIELD_TYPES) {
      const el = type.createEl('option', { value: option.id, text: option.label })
      if (option.id === field.type) el.selected = true
    }
    type.addEventListener('change', () => {
      field.type = type.value as CustomFieldDef['type']
      this.save({ customFields: project.customFields })
      redraw()
    })

    new IconButton(row)
      .setIcon('x')
      .setTooltip('Remove field')
      .onClick(() => {
        project.customFields.splice(index, 1)
        this.save({ customFields: project.customFields })
        redraw()
      })

    if (field.type !== 'select' && field.type !== 'multiselect') return
    const options = field.options ?? []
    field.options = options
    const optionsWrap = row.createDiv('pm-cf-options')
    const drawOptions = (): void => {
      optionsWrap.empty()
      options.forEach((option, i) => {
        const optionRow = optionsWrap.createDiv('pm-cf-opt-row')
        const input = optionRow.createEl('input', { type: 'text', value: option, cls: 'pm-input pm-cf-opt-input' })
        input.placeholder = `Option ${i + 1}`
        input.addEventListener('change', () => {
          options[i] = input.value
          this.save({ customFields: project.customFields })
        })
        new IconButton(optionRow)
          .setIcon('x')
          .setTooltip('Remove option')
          .onClick(() => {
            options.splice(i, 1)
            this.save({ customFields: project.customFields })
            drawOptions()
          })
      })
      renderAddButton(optionsWrap, 'Add option', () => {
        options.push('')
        drawOptions()
      })
    }
    drawOptions()
  }

  private renderDangerZone(project: Project): void {
    const section = this.container.createDiv('pm-edit-danger')
    const text = section.createDiv('pm-edit-danger-text')
    text.createDiv({ cls: 'pm-edit-danger-title', text: 'Delete project' })
    text.createDiv({ cls: 'pm-modal-hint', text: 'Removes the project note. Its task files are left in the vault.' })
    new ButtonComponent(section)
      .setButtonText('Delete project')
      .setDestructive()
      .onClick(
        safeAsync(async () => {
          const ok = await confirmDialog(this.app, `Delete "${project.title}"?`)
          if (!ok) return
          await this.plugin.store.deleteProject(project)
          this.leaf.detach()
        })
      )
  }
}

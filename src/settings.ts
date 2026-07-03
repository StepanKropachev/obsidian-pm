import { AbstractInputSuggest, App, PluginSettingTab, Setting, Notice, getIconIds, setIcon } from 'obsidian'
import type PMPlugin from './main'
import { PMSettings, DEFAULT_SETTINGS, makeId } from './types'
import { flattenTasks } from './store/TaskTreeOps'

export type { PMSettings }
export { DEFAULT_SETTINGS }

/** Suggests Lucide icon ids for the status/priority icon inputs. Typed emoji are kept as-is. */
class IconSuggest extends AbstractInputSuggest<string> {
  protected getSuggestions(query: string): string[] {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return getIconIds()
      .filter((id) => id.includes(q))
      .slice(0, 24)
  }

  renderSuggestion(id: string, el: HTMLElement): void {
    el.addClass('pm-icon-suggestion')
    setIcon(el.createSpan({ cls: 'pm-icon-suggestion-glyph' }), id)
    el.createSpan({ text: id })
  }
}

/** Wire icon-name suggestions to an icon input; picking a suggestion saves through the input's change handler. */
function attachIconSuggest(app: App, input: HTMLInputElement): void {
  const suggest = new IconSuggest(app, input)
  suggest.onSelect((id) => {
    suggest.setValue(id)
    input.dispatchEvent(new Event('change'))
    suggest.close()
  })
}

export class PMSettingTab extends PluginSettingTab {
  plugin: PMPlugin

  constructor(app: App, plugin: PMPlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()
    containerEl.addClass('pm-settings')

    // ── General ──────────────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName('Projects folder')
      .setDesc('Vault folder where project files are stored.')
      .addText((text) =>
        text
          .setPlaceholder('Projects')
          .setValue(this.plugin.settings.projectsFolder)
          .onChange(async (v) => {
            this.plugin.settings.projectsFolder = v.trim() || 'Projects'
            await this.plugin.saveSettings()
          })
      )

    new Setting(containerEl)
      .setName('Default view')
      .setDesc('Which view opens when you open a project.')
      .addDropdown((dd) =>
        dd
          .addOption('table', 'Table')
          .addOption('gantt', 'Gantt')
          .addOption('kanban', 'Board')
          .setValue(this.plugin.settings.defaultView)
          .onChange(async (v) => {
            this.plugin.settings.defaultView = v as PMSettings['defaultView']
            await this.plugin.saveSettings()
          })
      )

    new Setting(containerEl).setName('Default gantt granularity').addDropdown((dd) =>
      dd
        .addOption('day', 'Day')
        .addOption('week', 'Week')
        .addOption('month', 'Month')
        .addOption('quarter', 'Quarter')
        .setValue(this.plugin.settings.ganttGranularity)
        .onChange(async (v) => {
          this.plugin.settings.ganttGranularity = v as PMSettings['ganttGranularity']
          await this.plugin.saveSettings()
        })
    )

    new Setting(containerEl)
      .setName('Gantt week label')
      .setDesc('What to display in weekly gantt header cells.')
      .addDropdown((dd) =>
        dd
          .addOption('weekNumber', 'Week number (w15)')
          .addOption('dateRange', 'Date range (apr 7\u201313)')
          .addOption('both', 'Both (w15: apr 7\u201313)')
          .setValue(this.plugin.settings.ganttWeekLabel)
          .onChange(async (v) => {
            this.plugin.settings.ganttWeekLabel = v as PMSettings['ganttWeekLabel']
            await this.plugin.saveSettings()
          })
      )

    new Setting(containerEl)
      .setName('Show subtasks on board')
      .setDesc('Display subtasks as individual cards on the kanban board.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.kanbanShowSubtasks).onChange(async (v) => {
          this.plugin.settings.kanbanShowSubtasks = v
          await this.plugin.saveSettings()
        })
      )

    new Setting(containerEl)
      .setName('Show description preview on board')
      .setDesc('Display the first few lines of each task description on kanban cards.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.kanbanShowDescriptionPreview).onChange(async (v) => {
          this.plugin.settings.kanbanShowDescriptionPreview = v
          await this.plugin.saveSettings()
          this.plugin.refreshProjectViews()
        })
      )

    new Setting(containerEl)
      .setName('Show tag colors')
      .setDesc('Show a colored dot on each tag, derived from its name. Turn off for plain tags.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showTagColors).onChange(async (v) => {
          this.plugin.settings.showTagColors = v
          await this.plugin.saveSettings()
        })
      )

    new Setting(containerEl)
      .setName('Save tasks on close')
      .setDesc('Automatically save tasks when you close the task modal. When off, only clicking save persists changes.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.saveTaskOnClose).onChange(async (v) => {
          this.plugin.settings.saveTaskOnClose = v
          await this.plugin.saveSettings()
        })
      )

    // ── Notifications ─────────────────────────────────────────────────────────
    new Setting(containerEl).setName('Due date notifications').setHeading()

    new Setting(containerEl)
      .setName('Enable notifications')
      .setDesc('Show a banner when tasks are approaching their due date.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.notificationsEnabled).onChange(async (v) => {
          this.plugin.settings.notificationsEnabled = v
          await this.plugin.saveSettings()
        })
      )

    new Setting(containerEl)
      .setName('Lead time (days)')
      .setDesc('How many days before the due date to show the notification.')
      .addSlider((sl) =>
        sl
          .setLimits(1, 14, 1)
          .setValue(this.plugin.settings.notificationLeadDays)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.notificationLeadDays = v
            await this.plugin.saveSettings()
          })
      )

    // ── Scheduling ───────────────────────────────────────────────────────────
    new Setting(containerEl).setName('Scheduling').setHeading()

    new Setting(containerEl)
      .setName('Auto-schedule')
      .setDesc('Automatically adjust dependent task dates when a task changes.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoSchedule).onChange(async (v) => {
          this.plugin.settings.autoSchedule = v
          await this.plugin.saveSettings()
        })
      )

    // ── Team Members ──────────────────────────────────────────────────────────
    new Setting(containerEl).setName('Team members').setHeading()

    containerEl.createEl('p', {
      cls: 'pm-settings-desc',
      text: 'Global list of people available as assignees across all projects.'
    })
    // margin handled by .pm-settings-desc CSS class

    const membersContainer = containerEl.createDiv('pm-settings-members')
    this.renderMembersList(membersContainer)

    new Setting(containerEl).addButton((btn) =>
      btn
        .setButtonText('+ add member')
        .setCta()
        .onClick(() => {
          this.plugin.settings.globalTeamMembers.push('')
          void this.plugin.saveSettings()
          this.renderMembersList(membersContainer)
        })
    )

    // ── Statuses ──────────────────────────────────────────────────────────────
    new Setting(containerEl).setName('Statuses').setHeading()
    containerEl.createEl('p', {
      cls: 'pm-settings-desc',
      text: 'Customize status labels, colors, and icons. Drag to reorder.'
    })

    const statusContainer = containerEl.createDiv('pm-settings-statuses')
    this.renderStatusList(statusContainer)

    new Setting(containerEl).addButton((btn) =>
      btn
        .setButtonText('+ add status')
        .setCta()
        .onClick(() => {
          const id = 'status-' + makeId().slice(0, 6)
          this.plugin.settings.statuses.push({
            id,
            label: 'New status',
            color: '#8a94a0',
            icon: '',
            complete: false
          })
          void this.plugin.saveSettings()
          this.renderStatusList(statusContainer)
        })
    )

    // ── Priorities ────────────────────────────────────────────────────────────
    new Setting(containerEl).setName('Priorities').setHeading()
    containerEl.createEl('p', {
      cls: 'pm-settings-desc',
      text: 'Customize priority labels, colors, and icons. Drag to reorder from most to least important.'
    })

    const priorityContainer = containerEl.createDiv('pm-settings-statuses')
    this.renderPriorityList(priorityContainer)

    new Setting(containerEl).addButton((btn) =>
      btn
        .setButtonText('+ add priority')
        .setCta()
        .onClick(() => {
          const id = 'priority-' + makeId().slice(0, 6)
          this.plugin.settings.priorities.push({
            id,
            label: 'New priority',
            color: '#8a94a0',
            icon: ''
          })
          void this.plugin.saveSettings()
          this.renderPriorityList(priorityContainer)
        })
    )
  }

  private renderMembersList(container: HTMLElement): void {
    container.empty()
    const members = this.plugin.settings.globalTeamMembers
    members.forEach((m, i) => {
      const row = container.createDiv('pm-settings-member-row')
      const input = row.createEl('input', { type: 'text', value: m })
      input.placeholder = 'Name'
      input.addEventListener('change', () => {
        this.plugin.settings.globalTeamMembers[i] = input.value
        void this.plugin.saveSettings()
      })
      const del = row.createEl('button', { text: '✕' })
      del.addClass('pm-settings-del')
      del.addEventListener('click', () => {
        this.plugin.settings.globalTeamMembers.splice(i, 1)
        void this.plugin.saveSettings()
        this.renderMembersList(container)
      })
    })
  }

  private async remapOrphanTasks(field: 'status' | 'priority', deletedId: string, deletedLabel: string): Promise<void> {
    const configs = field === 'status' ? this.plugin.settings.statuses : this.plugin.settings.priorities
    if (configs.length === 0) return
    const fallback = configs[0]
    const folder = this.plugin.settings.projectsFolder
    const projects = await this.plugin.store.loadAllProjects(folder)
    let remapped = 0
    for (const project of projects) {
      const ids = flattenTasks(project.tasks)
        .filter(({ task }) => task[field] === deletedId)
        .map(({ task }) => task.id)
      if (ids.length) {
        await this.plugin.store.updateTasks(project, ids, { [field]: fallback.id })
        remapped += ids.length
      }
    }
    if (remapped > 0) {
      new Notice(`Remapped ${remapped} task${remapped === 1 ? '' : 's'} from '${deletedLabel}' to '${fallback.label}'.`)
    }
  }

  /** Wire drag-to-reorder on a config row; on drop, moves the dragged item to this row's index. */
  private wireRowDragReorder<T>(row: HTMLElement, index: number, items: T[], rerender: () => void): void {
    row.createSpan({ text: '⠿', cls: 'pm-settings-drag-handle' })
    row.draggable = true
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', String(index))
      row.addClass('pm-settings-row--dragging')
    })
    row.addEventListener('dragend', () => {
      row.removeClass('pm-settings-row--dragging')
    })
    row.addEventListener('dragover', (e) => {
      e.preventDefault()
    })
    row.addEventListener('drop', (e) => {
      e.preventDefault()
      const fromIdx = parseInt(e.dataTransfer?.getData('text/plain') ?? '', 10)
      if (isNaN(fromIdx) || fromIdx === index) return
      const [moved] = items.splice(fromIdx, 1)
      items.splice(index, 0, moved)
      void this.plugin.saveSettings()
      rerender()
    })
  }

  private renderStatusList(container: HTMLElement): void {
    container.empty()
    this.plugin.settings.statuses.forEach((s, i) => {
      const row = container.createDiv('pm-settings-status-row')

      this.wireRowDragReorder(row, i, this.plugin.settings.statuses, () => this.renderStatusList(container))

      // Icon input: emoji or a Lucide icon id (with suggestions)
      const icon = row.createEl('input', { type: 'text', value: s.icon })
      icon.addClass('pm-settings-status-icon')
      icon.placeholder = ''
      attachIconSuggest(this.app, icon)
      icon.addEventListener('change', () => {
        this.plugin.settings.statuses[i].icon = icon.value
        void this.plugin.saveSettings()
      })

      // Label input
      const label = row.createEl('input', { type: 'text', value: s.label })
      label.addClass('pm-settings-status-label')
      label.addEventListener('change', () => {
        this.plugin.settings.statuses[i].label = label.value
        void this.plugin.saveSettings()
      })

      // Color picker
      const color = row.createEl('input', { type: 'color', value: s.color })
      color.addEventListener('change', () => {
        this.plugin.settings.statuses[i].color = color.value
        void this.plugin.saveSettings()
      })

      // Complete toggle
      const completeLabel = row.createEl('label', { cls: 'pm-settings-complete-toggle' })
      const checkbox = completeLabel.createEl('input', { type: 'checkbox' })
      checkbox.checked = s.complete
      completeLabel.createSpan({ text: 'Done', cls: 'pm-settings-complete-text' })
      checkbox.addEventListener('change', () => {
        this.plugin.settings.statuses[i].complete = checkbox.checked
        void this.plugin.saveSettings()
      })

      // Delete button
      const del = row.createEl('button', { text: '✕', cls: 'pm-settings-del' })
      del.addEventListener('click', () => {
        if (this.plugin.settings.statuses.length <= 1) {
          new Notice('You must have at least one status.')
          return
        }
        const deletedStatus = this.plugin.settings.statuses[i]
        this.plugin.settings.statuses.splice(i, 1)
        void this.plugin.saveSettings()
        this.renderStatusList(container)
        void this.remapOrphanTasks('status', deletedStatus.id, deletedStatus.label)
      })
    })
  }

  private renderPriorityList(container: HTMLElement): void {
    container.empty()
    this.plugin.settings.priorities.forEach((p, i) => {
      const row = container.createDiv('pm-settings-status-row')

      this.wireRowDragReorder(row, i, this.plugin.settings.priorities, () => this.renderPriorityList(container))

      // Icon input: emoji or a Lucide icon id (with suggestions)
      const icon = row.createEl('input', { type: 'text', value: p.icon })
      icon.addClass('pm-settings-status-icon')
      icon.placeholder = ''
      attachIconSuggest(this.app, icon)
      icon.addEventListener('change', () => {
        this.plugin.settings.priorities[i].icon = icon.value
        void this.plugin.saveSettings()
      })

      // Label input
      const label = row.createEl('input', { type: 'text', value: p.label })
      label.addClass('pm-settings-status-label')
      label.addEventListener('change', () => {
        this.plugin.settings.priorities[i].label = label.value
        void this.plugin.saveSettings()
      })

      // Color picker
      const color = row.createEl('input', { type: 'color', value: p.color })
      color.addEventListener('change', () => {
        this.plugin.settings.priorities[i].color = color.value
        void this.plugin.saveSettings()
      })

      // Delete button
      const del = row.createEl('button', { text: '✕', cls: 'pm-settings-del' })
      del.addEventListener('click', () => {
        if (this.plugin.settings.priorities.length <= 1) {
          new Notice('You must have at least one priority.')
          return
        }
        const deletedPriority = this.plugin.settings.priorities[i]
        this.plugin.settings.priorities.splice(i, 1)
        void this.plugin.saveSettings()
        this.renderPriorityList(container)
        void this.remapOrphanTasks('priority', deletedPriority.id, deletedPriority.label)
      })
    })
  }
}

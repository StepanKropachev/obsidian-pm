import { App, PluginSettingTab, Setting, Notice } from 'obsidian'
import type PMPlugin from './main'
import { PMSettings, DEFAULT_SETTINGS, makeId } from './types'
import { flattenTasks } from './store/TaskTreeOps'
import { getTaskNotesApi, importTaskNotesPalettes, isTaskNotesInstalled } from './integrations/tasknotes'
import { renderPriorityListEditor, renderStatusListEditor } from './ui/PaletteListEditor'
import { IconButton } from './ui/primitives/IconButton'

export type { PMSettings }
export { DEFAULT_SETTINGS }

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

    if (isTaskNotesInstalled(this.app)) {
      new Setting(containerEl).setName('TaskNotes').setHeading()

      new Setting(containerEl)
        .setName('Import statuses and priorities')
        .setDesc('Add or update statuses and priorities to match TaskNotes. Entries TaskNotes does not know are kept.')
        .addButton((btn) =>
          btn.setButtonText('Import from TaskNotes').onClick(() => {
            const api = getTaskNotesApi(this.app)
            if (!api) {
              new Notice('TaskNotes 4.10 or newer is required.')
              return
            }
            const { added, updated } = importTaskNotesPalettes(api, this.plugin.settings)
            void this.plugin.saveSettings()
            this.display()
            new Notice(
              added || updated
                ? `Imported from TaskNotes: ${added} added, ${updated} updated.`
                : 'Statuses and priorities already match TaskNotes.'
            )
          })
        )
    }
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
      new IconButton(row)
        .setIcon('x')
        .setTooltip('Remove member')
        .onClick(() => {
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
      // A project that defines this status or priority itself is unaffected by the global delete.
      const own = field === 'status' ? project.config?.statuses : project.config?.priorities
      if (own?.some((entry) => entry.id === deletedId)) continue
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

  private renderStatusList(container: HTMLElement): void {
    renderStatusListEditor(container, {
      app: this.app,
      statuses: this.plugin.settings.statuses,
      onChanged: () => void this.plugin.saveSettings(),
      onDeleted: (deleted) => void this.remapOrphanTasks('status', deleted.id, deleted.label)
    })
  }

  private renderPriorityList(container: HTMLElement): void {
    renderPriorityListEditor(container, {
      app: this.app,
      priorities: this.plugin.settings.priorities,
      onChanged: () => void this.plugin.saveSettings(),
      onDeleted: (deleted) => void this.remapOrphanTasks('priority', deleted.id, deleted.label)
    })
  }
}

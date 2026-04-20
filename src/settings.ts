import { App, PluginSettingTab, Setting, Notice } from 'obsidian'
import type PMPlugin from './main'
import { PMSettings, DEFAULT_SETTINGS, makeId } from './types'
import { flattenTasks } from './store/TaskTreeOps'

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

  private async remapOrphanTasks(deletedId: string, deletedLabel: string): Promise<void> {
    const statuses = this.plugin.settings.statuses
    if (statuses.length === 0) return
    const defaultStatus = statuses[0]
    const folder = this.plugin.settings.projectsFolder
    const projects = await this.plugin.store.loadAllProjects(folder)
    let remapped = 0
    for (const project of projects) {
      const flat = flattenTasks(project.tasks)
      let modified = false
      for (const { task } of flat) {
        if (task.status === deletedId) {
          task.status = defaultStatus.id
          task.updatedAt = new Date().toISOString()
          remapped++
          modified = true
        }
      }
      if (modified) {
        await this.plugin.store.saveProject(project)
      }
    }
    if (remapped > 0) {
      new Notice(
        `Remapped ${remapped} task${remapped === 1 ? '' : 's'} from '${deletedLabel}' to '${defaultStatus.label}'.`
      )
    }
  }

  private renderStatusList(container: HTMLElement): void {
    container.empty()
    this.plugin.settings.statuses.forEach((s, i) => {
      const row = container.createDiv('pm-settings-status-row')

      // Drag handle
      row.createEl('span', { text: '⠿', cls: 'pm-settings-drag-handle' })
      row.draggable = true
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plain', String(i))
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
        if (isNaN(fromIdx) || fromIdx === i) return
        const statuses = this.plugin.settings.statuses
        const [moved] = statuses.splice(fromIdx, 1)
        statuses.splice(i, 0, moved)
        void this.plugin.saveSettings()
        this.renderStatusList(container)
      })

      // Icon input
      const icon = row.createEl('input', { type: 'text', value: s.icon })
      icon.addClass('pm-settings-status-icon')
      icon.placeholder = ''
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
      completeLabel.createEl('span', { text: 'Done', cls: 'pm-settings-complete-text' })
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
        void this.remapOrphanTasks(deletedStatus.id, deletedStatus.label)
      })
    })
  }
}

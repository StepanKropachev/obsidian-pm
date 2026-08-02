import { App, Notice, PluginSettingTab, Setting } from 'obsidian'
import type { SettingDefinitionItem, SettingDefinitionPage } from 'obsidian'
import type PMPlugin from './main'
import { type PMSettings, DEFAULT_SETTINGS, makeId } from './types'
import { flattenTasks } from './store/TaskTreeOps'
import {
  countTaskNotesPaletteChanges,
  getTaskNotesApi,
  importTaskNotesPalettes,
  isTaskNotesInstalled
} from './integrations/tasknotes'
import { renderPaletteFields, renderStatusDoneToggle } from './ui/PaletteListEditor'

export type { PMSettings }
export { DEFAULT_SETTINGS }

function plural(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export class PMSettingTab extends PluginSettingTab {
  plugin: PMPlugin

  constructor(app: App, plugin: PMPlugin) {
    super(app, plugin)
    this.plugin = plugin
    this.icon = 'chart-gantt'
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: 'group',
        heading: 'General',
        items: [
          {
            name: 'Projects folder',
            desc: 'Vault folder where project files are stored.',
            control: {
              type: 'folder',
              key: 'projectsFolder',
              defaultValue: 'Projects',
              placeholder: 'Projects',
              validate: (value) => (value.trim() ? undefined : 'Enter a folder name.')
            }
          },
          {
            name: 'Default view',
            desc: 'View that opens when a project is opened.',
            control: {
              type: 'dropdown',
              key: 'defaultView',
              options: { table: 'Table', gantt: 'Gantt', kanban: 'Board' }
            }
          },
          {
            name: 'Save tasks on close',
            desc: 'Save changes when the task editor is closed.',
            control: { type: 'toggle', key: 'saveTaskOnClose' }
          }
        ]
      },
      {
        type: 'group',
        heading: 'Style',
        items: [
          {
            name: 'Show tag colors',
            desc: 'Give each tag a colored dot derived from its name.',
            aliases: ['appearance'],
            control: { type: 'toggle', key: 'showTagColors' }
          }
        ]
      },
      {
        type: 'group',
        heading: 'Gantt',
        items: [
          {
            name: 'Default granularity',
            desc: 'Time unit for each column in the timeline.',
            aliases: ['timeline', 'zoom'],
            control: {
              type: 'dropdown',
              key: 'ganttGranularity',
              options: { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter' }
            }
          },
          {
            name: 'Week label',
            desc: 'Text shown in weekly header cells.',
            aliases: ['timeline'],
            control: {
              type: 'dropdown',
              key: 'ganttWeekLabel',
              options: {
                weekNumber: 'Week number (w15)',
                dateRange: 'Date range (apr 7\u201313)',
                both: 'Both (w15: apr 7\u201313)'
              }
            }
          }
        ]
      },
      {
        type: 'group',
        heading: 'Board',
        items: [
          {
            name: 'Show subtasks',
            desc: 'Display subtasks as individual cards.',
            aliases: ['kanban'],
            control: { type: 'toggle', key: 'kanbanShowSubtasks' }
          },
          {
            name: 'Show description preview',
            desc: 'Display the first few lines of each task description.',
            aliases: ['kanban'],
            control: { type: 'toggle', key: 'kanbanShowDescriptionPreview' }
          }
        ]
      },
      {
        type: 'group',
        heading: 'Scheduling',
        items: [
          {
            name: 'Auto-schedule',
            desc: 'Adjust dependent task dates when a task changes.',
            aliases: ['dependencies'],
            control: { type: 'toggle', key: 'autoSchedule' }
          },
          {
            name: 'Pull dependents forward',
            desc: 'Move dependent tasks earlier when a task is completed before its due date.',
            aliases: ['dependencies'],
            control: {
              type: 'toggle',
              key: 'pullForwardOnEarlyFinish',
              disabled: () => !this.plugin.settings.autoSchedule
            }
          }
        ]
      },
      {
        type: 'group',
        heading: 'Notifications',
        items: [
          {
            name: 'Due date reminders',
            desc: 'Show a banner when a task is approaching its due date.',
            aliases: ['notifications', 'banner'],
            control: { type: 'toggle', key: 'notificationsEnabled' }
          },
          {
            name: 'Days in advance',
            desc: 'How many days before the due date to notify.',
            aliases: ['notifications', 'reminders', 'lead time'],
            control: {
              type: 'slider',
              key: 'notificationLeadDays',
              min: 1,
              max: 14,
              step: 1,
              disabled: () => !this.plugin.settings.notificationsEnabled
            }
          }
        ]
      },
      {
        type: 'group',
        heading: 'Task fields',
        items: [this.statusesPage(), this.prioritiesPage(), this.teamMembersPage()]
      },
      {
        type: 'group',
        heading: 'Integrations',
        visible: () => isTaskNotesInstalled(this.app),
        items: [this.taskNotesPage()]
      }
    ]
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    await super.setControlValue(key, value)
    if (key === 'kanbanShowDescriptionPreview') this.plugin.refreshProjectViews()
    this.refreshDomState()
  }

  private statusesPage(): SettingDefinitionPage {
    const statuses = this.plugin.settings.statuses
    return {
      type: 'page',
      name: 'Statuses',
      desc: 'Labels, colors, and icons for the status field.',
      displayValue: () => plural(this.plugin.settings.statuses.length, 'status', 'statuses'),
      items: [
        {
          type: 'list',
          heading: 'Statuses',
          emptyState: 'No statuses.',
          items: statuses.map((status) => ({
            name: status.label,
            render: (setting: Setting) => {
              setting.setClass('pm-palette-row')
              renderPaletteFields(setting.controlEl, this.app, status, () => this.persist())
              renderStatusDoneToggle(setting.controlEl, status, () => this.persist())
            }
          })),
          onReorder: (from, to) => this.reorder(statuses, from, to),
          onDelete: (index) => this.deleteEntry('status', index),
          addItem: {
            name: 'Add status',
            action: () => {
              statuses.push({
                id: 'status-' + makeId().slice(0, 6),
                label: 'New status',
                color: '#8a94a0',
                icon: '',
                complete: false
              })
              this.persist()
              this.update()
            }
          }
        }
      ]
    }
  }

  private prioritiesPage(): SettingDefinitionPage {
    const priorities = this.plugin.settings.priorities
    return {
      type: 'page',
      name: 'Priorities',
      desc: 'Labels, colors, and icons for the priority field.',
      displayValue: () => plural(this.plugin.settings.priorities.length, 'priority', 'priorities'),
      items: [
        {
          type: 'list',
          heading: 'Priorities',
          emptyState: 'No priorities.',
          items: priorities.map((priority) => ({
            name: priority.label,
            render: (setting: Setting) => {
              setting.setClass('pm-palette-row')
              renderPaletteFields(setting.controlEl, this.app, priority, () => this.persist())
            }
          })),
          onReorder: (from, to) => this.reorder(priorities, from, to),
          onDelete: (index) => this.deleteEntry('priority', index),
          addItem: {
            name: 'Add priority',
            action: () => {
              priorities.push({
                id: 'priority-' + makeId().slice(0, 6),
                label: 'New priority',
                color: '#8a94a0',
                icon: ''
              })
              this.persist()
              this.update()
            }
          }
        }
      ]
    }
  }

  private taskNotesPage(): SettingDefinitionPage {
    const connected = (): boolean => getTaskNotesApi(this.app) !== null
    return {
      type: 'page',
      name: 'TaskNotes',
      desc: 'Share statuses and priorities with the TaskNotes plugin.',
      displayValue: () => this.taskNotesStatus(),
      status: () => (connected() ? null : 'warning'),
      items: [
        {
          type: 'list',
          extraButtons: [
            (button) =>
              button
                .setIcon('refresh-cw')
                .setTooltip('Import from TaskNotes')
                .setDisabled(!connected())
                .onClick(() => this.importFromTaskNotes())
          ],
          items: [
            {
              name: 'Statuses and priorities',
              desc: 'Copies labels, colors, and completion from TaskNotes 4.10 or newer.',
              render: (setting: Setting) => {
                setting.controlEl.createDiv({ cls: 'setting-item-value', text: this.taskNotesStatus() })
              }
            }
          ]
        }
      ]
    }
  }

  /** Whether an import would change anything right now, as a short value. */
  private taskNotesStatus(): string {
    const api = getTaskNotesApi(this.app)
    if (!api) return 'Update required'
    const { added, updated } = countTaskNotesPaletteChanges(api, this.plugin.settings)
    const total = added + updated
    return total === 0 ? 'Up to date' : plural(total, 'change', 'changes')
  }

  private teamMembersPage(): SettingDefinitionPage {
    const members = this.plugin.settings.globalTeamMembers
    return {
      type: 'page',
      name: 'Team members',
      desc: 'People available as assignees across all projects.',
      displayValue: () => plural(this.plugin.settings.globalTeamMembers.length, 'person', 'people'),
      items: [
        {
          type: 'list',
          heading: 'Team members',
          emptyState: 'No team members yet.',
          items: members.map((member, index) => ({
            name: member || 'Unnamed member',
            render: (setting: Setting) => {
              setting.setClass('pm-palette-row')
              setting.addText((text) =>
                text
                  .setPlaceholder('Name')
                  .setValue(member)
                  .onChange((value) => {
                    this.plugin.settings.globalTeamMembers[index] = value
                    this.persist()
                  })
              )
            }
          })),
          onReorder: (from, to) => this.reorder(members, from, to),
          onDelete: (index) => {
            members.splice(index, 1)
            this.persist()
            this.update()
          },
          addItem: {
            name: 'Add member',
            action: () => {
              members.push('')
              this.persist()
              this.update()
            }
          }
        }
      ]
    }
  }

  private persist(): void {
    void this.plugin.saveSettings()
  }

  private reorder<T>(items: T[], from: number, to: number): void {
    const [moved] = items.splice(from, 1)
    items.splice(to, 0, moved)
    this.persist()
    this.update()
  }

  private deleteEntry(field: 'status' | 'priority', index: number): void {
    const entries = field === 'status' ? this.plugin.settings.statuses : this.plugin.settings.priorities
    if (entries.length <= 1) {
      new Notice(`You must have at least one ${field}.`)
      return
    }
    const [removed] = entries.splice(index, 1)
    this.persist()
    this.update()
    void this.remapOrphanTasks(field, removed.id, removed.label)
  }

  private importFromTaskNotes(): void {
    const api = getTaskNotesApi(this.app)
    if (!api) {
      new Notice('TaskNotes 4.10 or newer is required.')
      return
    }
    const { added, updated } = importTaskNotesPalettes(api, this.plugin.settings)
    this.persist()
    this.update()
    new Notice(
      added || updated
        ? `Imported from TaskNotes: ${added} added, ${updated} updated.`
        : 'Statuses and priorities already match TaskNotes.'
    )
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
}

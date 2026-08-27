import { App, Notice, PluginSettingTab, Setting, debounce } from 'obsidian'
import type { SettingDefinitionItem, SettingDefinitionPage } from 'obsidian'
import type PMPlugin from './main'
import { type PMSettings, DEFAULT_SETTINGS, PRIORITY_ICON_SET_LABELS, makeId } from './types'
import { flattenTasks } from './store/TaskTreeOps'
import {
  countTaskNotesPaletteChanges,
  getTaskNotesApi,
  importTaskNotesPalettes,
  isTaskNotesInstalled
} from './integrations/tasknotes'
import { renderPaletteFields, renderStatusDoneToggle } from './ui/PaletteListEditor'
import { renderCustomFieldFields, renderCustomFieldOptions } from './ui/CustomFieldListEditor'
import { renderPersonPicker } from './ui/PersonPicker'

export type { PMSettings }
export { DEFAULT_SETTINGS }

function plural(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export class PMSettingTab extends PluginSettingTab {
  plugin: PMPlugin
  /** A folder name is typed one character at a time; each sweep costs the whole vault. */
  private readonly rebuildIndex: () => void

  constructor(app: App, plugin: PMPlugin) {
    super(app, plugin)
    this.plugin = plugin
    this.icon = 'chart-gantt'
    this.rebuildIndex = debounce(() => this.plugin.index.build(), 500)
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: 'group',
        heading: 'General',
        items: [
          {
            name: 'New project folder',
            desc: 'Leave it empty to create them in the vault root.',
            aliases: ['projects folder', 'location'],
            control: {
              type: 'folder',
              key: 'projectsFolder',
              defaultValue: 'Projects',
              placeholder: 'Vault root'
            }
          },
          this.excludedFoldersPage(),
          {
            name: 'Open projects in',
            desc: 'Tasks skips the overview page and goes straight to the table, timeline, or board.',
            aliases: ['click', 'project list', 'overview'],
            control: {
              type: 'dropdown',
              key: 'projectSurface',
              options: { overview: 'Overview', tasks: 'Tasks' }
            }
          },
          {
            name: 'Default tasks view',
            desc: "View a project's tasks open in.",
            aliases: ['default view'],
            control: {
              type: 'dropdown',
              key: 'defaultView',
              options: { table: 'Table', gantt: 'Gantt', kanban: 'Board' }
            }
          },
          {
            name: 'Open tasks in',
            desc: "Tab also opens task notes in the task editor instead of Obsidian's.",
            control: {
              type: 'dropdown',
              key: 'taskEditorSurface',
              options: { modal: 'Modal', tab: 'Tab' }
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
          },
          {
            name: 'Priority icons',
            desc: 'Icon set for priorities that have no icon of their own.',
            aliases: ['appearance', 'chevrons', 'signal'],
            control: {
              type: 'dropdown',
              key: 'priorityIcons',
              options: PRIORITY_ICON_SET_LABELS
            }
          }
        ]
      },
      {
        type: 'group',
        heading: 'Table',
        items: [
          {
            name: 'Show subtree connections',
            desc: 'Draw lines tying a subtask row back to its parent.',
            aliases: ['tree', 'indent', 'subtask'],
            control: { type: 'toggle', key: 'showSubtreeConnections' }
          },
          {
            name: 'Line borders',
            desc: 'Rules drawn between rows, between columns, or both.',
            aliases: ['grid', 'lines'],
            control: {
              type: 'dropdown',
              key: 'lineBorders',
              options: { none: 'None', horizontal: 'Horizontal', vertical: 'Vertical', both: 'Both' }
            }
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
        heading: 'Archive',
        items: [
          {
            name: 'Auto-archive completed tasks',
            desc: "Move completed tasks to the project's archive after this many days. Set it to 0 to keep them in place.",
            aliases: ['archive', 'cleanup', 'done'],
            control: {
              type: 'slider',
              key: 'autoArchiveDays',
              min: 0,
              max: 90,
              step: 1
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
        items: [this.statusesPage(), this.prioritiesPage(), this.customFieldsPage(), this.teamMembersPage()]
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
    // Today's pass ran against the old window, so it has to run again to reflect the new one.
    if (key === 'autoArchiveDays') {
      this.plugin.settings.lastAutoArchiveDate = ''
      await this.plugin.autoArchiver.check()
    }
    this.plugin.refreshViews()
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
              renderPaletteFields(setting.controlEl, status, () => this.persist())
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

  private customFieldsPage(): SettingDefinitionPage {
    const fields = this.plugin.settings.customFields
    return {
      type: 'page',
      name: 'Custom fields',
      desc: 'Extra task properties available across all projects.',
      displayValue: () => plural(this.plugin.settings.customFields.length, 'field', 'fields'),
      items: [
        {
          type: 'list',
          heading: 'Custom fields',
          emptyState: 'No custom fields.',
          items: fields.map((field) => ({
            name: field.name,
            render: (setting: Setting) => {
              setting.setClass('pm-palette-row')
              setting.setClass('pm-cf-settings-row')
              renderCustomFieldFields(
                setting.controlEl,
                field,
                () => this.persist(),
                () => this.update()
              )
              renderCustomFieldOptions(setting.controlEl, field, () => this.persist())
            }
          })),
          onReorder: (from, to) => this.reorder(fields, from, to),
          onDelete: (index) => {
            fields.splice(index, 1)
            this.persist()
            this.update()
          },
          addItem: {
            name: 'Add custom field',
            action: () => {
              fields.push({ id: makeId(), name: 'New field', type: 'text' })
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
              renderPaletteFields(setting.controlEl, priority, () => this.persist())
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

  /** Whether an import would change anything right now. */
  private taskNotesStatus(): string {
    const api = getTaskNotesApi(this.app)
    if (!api) return 'Update required'
    const { added, updated } = countTaskNotesPaletteChanges(api, this.plugin.settings)
    const total = added + updated
    return total === 0 ? 'Up to date' : plural(total, 'change', 'changes')
  }

  private excludedFoldersPage(): SettingDefinitionPage {
    const folders = this.plugin.settings.excludedFolders
    return {
      type: 'page',
      name: 'Excluded folders',
      desc: 'Folders to skip when looking for projects and tasks, such as templates.',
      displayValue: () => plural(this.plugin.settings.excludedFolders.length, 'folder', 'folders'),
      items: [
        {
          type: 'list',
          heading: 'Excluded folders',
          emptyState: 'No folders excluded.',
          items: folders.map((folder, index) => ({
            name: folder || 'Unnamed folder',
            render: (setting: Setting) => {
              setting.setClass('pm-palette-row')
              setting.addText((text) =>
                text
                  .setPlaceholder('Templates')
                  .setValue(folder)
                  .onChange((value) => {
                    this.plugin.settings.excludedFolders[index] = value
                    this.persist()
                    this.rebuildIndex()
                  })
              )
            }
          })),
          onDelete: (index) => {
            folders.splice(index, 1)
            this.persist()
            this.plugin.index.build()
            this.update()
          },
          addItem: {
            name: 'Add folder',
            action: () => {
              folders.push('')
              this.persist()
              this.update()
            }
          }
        }
      ]
    }
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
          name: 'People folder',
          desc: 'Where person notes are looked for and created. Leave it empty to search the whole vault.',
          aliases: ['people', 'person notes'],
          control: {
            type: 'folder',
            key: 'peopleFolder',
            defaultValue: 'People',
            placeholder: 'Whole vault'
          }
        },
        {
          name: 'Team members',
          desc: 'Offered as assignees and members in every project.',
          render: (setting: Setting) => {
            renderPersonPicker({
              container: setting.controlEl,
              plugin: this.plugin,
              sourcePath: '',
              addLabel: 'Add member',
              selected: () => this.plugin.settings.globalTeamMembers,
              add: (value) => {
                members.push(value)
                this.persist()
              },
              remove: (value) => {
                const index = members.indexOf(value)
                if (index >= 0) members.splice(index, 1)
                this.persist()
              }
            })
          }
        }
      ]
    }
  }

  private persist(): void {
    void this.plugin.saveSettings()
    this.plugin.refreshViews()
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
    // Only projects the index says still use the deleted value are worth loading.
    const affected = this.plugin.index
      .projectRefs()
      .filter((ref) => this.plugin.index.taskRefs(ref.path).some((task) => task[field] === deletedId))
      .map((ref) => ref.path)
    const projects = await this.plugin.store.loadProjects(affected)
    let remapped = 0
    for (const project of projects) {
      // A project defining this status or priority itself is unaffected by a global delete.
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

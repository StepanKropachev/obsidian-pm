import { ButtonComponent, ItemView, WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '../../main'
import type { Task } from '../../types'
import { DEFAULT_PRIORITIES, DEFAULT_STATUSES, makeTask } from '../../types'
import { renderDueChip } from '../../ui/composites/dueChip'
import { renderTagChip } from '../../ui/composites/tagChip'
import { renderTimeChip } from '../../ui/composites/timeChip'
import { ActionsCell } from '../../ui/composites/cells/ActionsCell'
import { AssigneesCell } from '../../ui/composites/cells/AssigneesCell'
import { DueDateCell } from '../../ui/composites/cells/DueDateCell'
import { ExpandCell } from '../../ui/composites/cells/ExpandCell'
import { PriorityCell } from '../../ui/composites/cells/PriorityCell'
import { ProgressCell } from '../../ui/composites/cells/ProgressCell'
import { SelectCell } from '../../ui/composites/cells/SelectCell'
import { StatusCell } from '../../ui/composites/cells/StatusCell'
import { TimeCell } from '../../ui/composites/cells/TimeCell'
import { KanbanCard } from '../../ui/composites/KanbanCard'
import { ProjectCard } from '../../ui/composites/ProjectCard'
import { TaskRow } from '../../ui/composites/TaskRow'
import { renderAddButton } from '../../ui/composites/addButton'
import { renderAddProperty } from '../../ui/composites/properties'
import { renderChipList, renderPropRow } from '../../ui/FormField'
import { renderFilterDropdown } from '../../ui/FilterDropdown'
import { Avatar } from '../../ui/primitives/Avatar'
import { AvatarStack } from '../../ui/primitives/AvatarStack'
import { Chip } from '../../ui/primitives/Chip'
import { CollapseToggle } from '../../ui/primitives/CollapseToggle'
import { EmptyState } from '../../ui/primitives/EmptyState'
import { IconButton } from '../../ui/primitives/IconButton'
import { ChipButton } from '../../ui/primitives/ChipButton'
import { Popover } from '../../ui/primitives/Popover'
import { ProgressBar } from '../../ui/primitives/ProgressBar'
import { SegmentedControl } from '../../ui/primitives/SegmentedControl'
import { ViewSwitcher } from '../../ui/primitives/ViewSwitcher'
import { renderPriorityBadge, renderStatusBadge, renderStatusDot } from '../../ui/StatusBadge'
import { safeAsync } from '../../utils'

export const PM_STYLEGUIDE_VIEW_TYPE = 'pm-styleguide'

const noop = (): void => undefined
const noopAsync = (): Promise<void> => Promise.resolve()
const PEOPLE = ['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Margaret Hamilton', 'Edsger Dijkstra']
const WIKILINK_PERSON = '[[People/Alan Turing|Alan]]'

/**
 * Dev-only gallery of every primitive and key composite in all their variants,
 * rendered in a real Obsidian pane so the CSS cascade (app.css included) is the
 * one users actually get. Only compiled in when `__STYLEGUIDE__` is true.
 * Catalog: docs/styleguide.md. Mock data only, no store or vault access.
 */
export class StyleguideView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
    this.navigation = false
  }

  getViewType(): string {
    return PM_STYLEGUIDE_VIEW_TYPE
  }
  getDisplayText(): string {
    return 'Styleguide'
  }
  getIcon(): string {
    return 'palette'
  }

  onOpen(): Promise<void> {
    this.containerEl.addClass('pm-view')
    const root = this.contentEl
    root.empty()
    root.addClass('pm-root', 'pm-styleguide')
    this.group('Primitives')
    this.renderChips()
    this.renderChipButtons()
    this.renderAvatars()
    this.renderIconButtons()
    this.renderProgress()
    this.renderCollapse()
    this.renderEmptyState()
    this.renderSegmented()
    this.renderViewSwitcher()
    this.renderPopover()
    this.group('Shared widgets')
    this.renderBadges()
    this.renderForm()
    this.group('Composites')
    this.renderDerivedChips()
    this.renderCards()
    this.renderTable()
    return Promise.resolve()
  }

  private group(title: string): void {
    this.contentEl.createDiv({ cls: 'pm-sg-group', text: title })
  }

  private section(title: string, id: string): HTMLElement {
    const sec = this.contentEl.createDiv({ cls: 'pm-sg-section', attr: { 'data-sg': id } })
    sec.createDiv({ cls: 'pm-sg-title', text: title })
    return sec
  }

  private row(sec: HTMLElement, caption: string): HTMLElement {
    sec.createDiv({ cls: 'pm-sg-caption', text: caption })
    return sec.createDiv('pm-sg-row')
  }

  private renderChips(): void {
    const sec = this.section('Chip', 'chip')
    for (const variant of ['solid', 'outline', 'plain'] as const) {
      const row = this.row(sec, variant)
      for (const status of DEFAULT_STATUSES) {
        new Chip(row).setLabel(status.label).setVariant(variant).setColor(status.color).setDot()
      }
    }
    const mods = this.row(sec, 'modifiers')
    new Chip(mods).setLabel('leading icon').setVariant('outline').setLeadingIcon('calendar')
    new Chip(mods).setLabel('tag').setVariant('outline').setTag()
    new Chip(mods).setLabel('strong').setVariant('solid').setColor('var(--color-red)').setStrong()
    new Chip(mods).setLabel('pill shape').setVariant('outline').setShape('pill')
    new Chip(mods).setLabel('small').setVariant('solid').setColor('var(--interactive-accent)').setSize('sm')
    new Chip(mods).setLabel('removable').setVariant('outline').setRemovable(noop)
    new Chip(mods).setLabel('interactive').setVariant('outline').onClick(noop)
  }

  private renderChipButtons(): void {
    const sec = this.section('ChipButton', 'chip-button')
    const row = this.row(sec, 'default / active / pill shape')
    new ChipButton(row).setLabel('Saved view')
    new ChipButton(row).setLabel('Active view').setActive(true)
    new ChipButton(row).setLabel('Due: 3').setShape('pill').setActive(true)
    const filterRow = this.row(sec, 'renderFilterDropdown')
    renderFilterDropdown(
      filterRow,
      'Status',
      ['todo'],
      DEFAULT_STATUSES.map((s) => ({ id: s.id, label: s.label })),
      noop
    )
  }

  private renderAvatars(): void {
    const sec = this.section('Avatar', 'avatar')
    const row = this.row(sec, 'md / sm / wikilink alias')
    new Avatar(row).setName(PEOPLE[0])
    new Avatar(row).setName(PEOPLE[1]).setSize('sm')
    new Avatar(row).setName(WIKILINK_PERSON)
    const stack = this.row(sec, 'AvatarStack with overflow (max 3)')
    new AvatarStack(stack).setNames(PEOPLE)
  }

  private renderIconButtons(): void {
    const sec = this.section('IconButton', 'icon-button')
    const row = this.row(sec, 'plain / reveal on hover (hover this row)')
    new IconButton(row).setIcon('pencil').setTooltip('Edit').onClick(noop)
    new IconButton(row).setIcon('trash-2').setTooltip('Delete').onClick(noop)
    new IconButton(row).setIcon('more-horizontal').setTooltip('Hidden until hover').setRevealOnHover(true).onClick(noop)
  }

  private renderProgress(): void {
    const sec = this.section('ProgressBar', 'progress')
    const row = this.row(sec, '0 / 50 / 100, sm, label, color')
    new ProgressBar(row).setValue(0)
    new ProgressBar(row).setValue(50)
    new ProgressBar(row).setValue(100)
    new ProgressBar(row).setValue(50).setSize('sm')
    new ProgressBar(row).setValue(75).setShowLabel(true)
    new ProgressBar(row).setValue(60).setColor('var(--color-green)')
  }

  private renderCollapse(): void {
    const sec = this.section('CollapseToggle', 'collapse')
    const row = this.row(sec, 'expanded / collapsed')
    new CollapseToggle(row, { collapsed: false, onToggle: noop })
    new CollapseToggle(row, { collapsed: true, onToggle: noop })
  }

  private renderEmptyState(): void {
    const sec = this.section('EmptyState', 'empty-state')
    const row = this.row(sec, 'icon, title, body, action')
    new EmptyState(row)
      .setIcon('📋')
      .setTitle('No projects yet')
      .setBody('Create your first project to get started.')
      .setAction('+ new project', noop)
  }

  private renderSegmented(): void {
    const sec = this.section('SegmentedControl', 'segmented')
    const row = this.row(sec, 'text options')
    new SegmentedControl(row, {
      options: [
        { id: 'task', label: 'Task' },
        { id: 'subtask', label: 'Subtask' },
        { id: 'milestone', label: 'Milestone' }
      ],
      active: 'task',
      onChange: noop
    })
  }

  private renderViewSwitcher(): void {
    const sec = this.section('ViewSwitcher', 'view-switcher')
    const row = this.row(sec, 'icon options')
    new ViewSwitcher(row, {
      options: [
        { id: 'table', icon: 'table', label: 'Table' },
        { id: 'gantt', icon: 'chart-gantt', label: 'Gantt' },
        { id: 'kanban', icon: 'kanban', label: 'Kanban' }
      ],
      active: 'table',
      onChange: noop
    })
  }

  private renderPopover(): void {
    const sec = this.section('Popover', 'popover')
    const row = this.row(sec, 'anchored panel (bottom sheet on phones)')
    let pop: Popover | null = null
    const btn = new ButtonComponent(row).setButtonText('Open popover')
    btn.onClick(() => {
      if (pop?.isOpen) {
        pop.close()
        return
      }
      pop = new Popover({ anchor: btn.buttonEl, width: 220, onClose: () => (pop = null) })
      pop.contentEl.createDiv({ text: 'Popover content: anything Menu cannot host.' })
      const search = pop.contentEl.createEl('input', { type: 'text' })
      search.placeholder = 'A focusable input'
      pop.open()
    })
  }

  private renderBadges(): void {
    const sec = this.section('Status and priority', 'badges')
    const statusRow = this.row(sec, 'renderStatusBadge (opens a picker menu)')
    for (const status of DEFAULT_STATUSES) {
      renderStatusBadge(statusRow, makeTask({ status: status.id }), DEFAULT_STATUSES, noop)
    }
    const prioRow = this.row(sec, 'renderPriorityBadge')
    for (const priority of DEFAULT_PRIORITIES) {
      renderPriorityBadge(prioRow, makeTask({ priority: priority.id }), DEFAULT_PRIORITIES, noop)
    }
    const dotRow = this.row(sec, 'renderStatusDot')
    for (const status of DEFAULT_STATUSES) {
      renderStatusDot(dotRow, status.id, DEFAULT_STATUSES)
    }
    const tagRow = this.row(sec, 'renderTagChip (plain / colored)')
    renderTagChip(tagRow, 'design', false)
    renderTagChip(tagRow, 'design', true)
    renderTagChip(tagRow, 'backend', true)
  }

  private renderForm(): void {
    const sec = this.section('Form patterns', 'form')
    const propRow = this.row(sec, 'renderPropRow')
    renderPropRow(
      propRow,
      'Due date',
      () => {
        const value = createDiv()
        new Chip(value).setLabel('Jul 20, 2026').setVariant('outline')
        return value
      },
      'calendar'
    )
    const chipListRow = this.row(sec, 'renderChipList')
    renderChipList(chipListRow, ['design', 'frontend'], { onRemove: noop, onAdd: noop })
    const addRow = this.row(sec, 'renderAddButton / renderAddProperty')
    renderAddButton(addRow, 'Add member', noop)
    renderAddProperty(addRow, [{ id: 'due', label: 'Due date', icon: 'calendar' }], noop)
  }

  private renderDerivedChips(): void {
    const sec = this.section('Time and due chips', 'time-due')
    const timeRow = this.row(sec, 'renderTimeChip: logged only / within estimate / over estimate')
    renderTimeChip(timeRow, 3, 0)
    renderTimeChip(timeRow, 5, 10)
    renderTimeChip(timeRow, 6, 4)
    const dueRow = this.row(sec, 'renderDueChip: normal / near / overdue')
    renderDueChip(dueRow, 'Jul 20, 2026', 'normal')
    renderDueChip(dueRow, 'Jul 6, 2026', 'near')
    renderDueChip(dueRow, 'Jun 20, 2026', 'overdue')
  }

  private renderCards(): void {
    const sec = this.section('Cards', 'cards')
    const projectRow = this.row(sec, 'ProjectCard')
    new ProjectCard(projectRow, {
      title: 'Website relaunch',
      icon: '📋',
      color: '#8b72be',
      tasksDone: 4,
      tasksTotal: 10,
      onClick: noop,
      onContextMenu: noop
    })
    const kanbanRow = this.row(sec, 'KanbanCard: plain / overdue milestone with everything')
    new KanbanCard(kanbanRow, {
      task: makeTask({ title: 'Write the launch announcement' }),
      loggedHours: 0,
      overdue: false,
      showTagColors: true,
      onClick: noop,
      onContextMenu: noop,
      onDragStart: noop,
      onDragEnd: noop
    })
    new KanbanCard(kanbanRow, {
      task: makeTask({
        title: 'Ship the redesign',
        type: 'milestone',
        priority: 'critical',
        due: '2026-06-20',
        assignees: ['Ada Lovelace', 'Grace Hopper'],
        tags: ['design', 'frontend']
      }),
      priorityColor: '#c47070',
      descriptionPreview: 'Everything that must land before the announcement goes out.',
      parentTitle: 'Website relaunch',
      subtaskProgress: { done: 2, total: 5 },
      loggedHours: 11,
      overdue: true,
      showTagColors: true,
      onClick: noop,
      onContextMenu: noop,
      onDragStart: noop,
      onDragEnd: noop
    })
  }

  private renderTable(): void {
    const sec = this.section('Table row and cells', 'table')
    sec.createDiv({ cls: 'pm-sg-caption', text: 'TaskRow + one of each cell composite' })
    const table = sec.createEl('table', { cls: 'pm-table' })
    const tbody = table.createEl('tbody')
    const rows: {
      task: Task
      props: { depth: number; isDone: boolean; isSelected: boolean }
      urgency: 'normal' | 'near' | 'overdue'
      time: { logged: number; estimate: number }
    }[] = [
      {
        task: makeTask({
          title: 'Design the settings screen',
          status: 'in-progress',
          priority: 'high',
          due: '2026-07-20',
          progress: 60,
          assignees: ['Ada Lovelace', 'Grace Hopper'],
          subtasks: [makeTask({ title: 'Pick a layout' })]
        }),
        props: { depth: 0, isDone: false, isSelected: false },
        urgency: 'normal',
        time: { logged: 5, estimate: 10 }
      },
      {
        task: makeTask({
          title: 'Fix the overdue banner',
          status: 'blocked',
          priority: 'critical',
          due: '2026-06-20',
          progress: 20,
          assignees: ['Alan Turing']
        }),
        props: { depth: 1, isDone: false, isSelected: true },
        urgency: 'overdue',
        time: { logged: 6, estimate: 4 }
      },
      {
        task: makeTask({ title: 'Archive old sprints', status: 'done', progress: 100 }),
        props: { depth: 0, isDone: true, isSelected: false },
        urgency: 'normal',
        time: { logged: 0, estimate: 0 }
      }
    ]
    for (const { task, props, urgency, time } of rows) {
      const tr = new TaskRow(tbody, {
        taskId: task.id,
        depth: props.depth,
        isDone: props.isDone,
        isArchived: false,
        isSelected: props.isSelected,
        onRowClick: noop
      })
      new ExpandCell(tr.el, { hasSubtasks: task.subtasks.length > 0, collapsed: false, onToggle: noop })
      new SelectCell(tr.el, { checked: props.isSelected, onClick: noop })
      tr.el.createEl('td', { cls: 'pm-table-cell-title', text: task.title })
      new StatusCell(tr.el, { task, statuses: DEFAULT_STATUSES, onChange: noop })
      new PriorityCell(tr.el, { task, priorities: DEFAULT_PRIORITIES, onChange: noop })
      new DueDateCell(tr.el, { task, urgency, onSave: noopAsync })
      new TimeCell(tr.el, time)
      new ProgressCell(tr.el, { value: task.progress, color: 'var(--interactive-accent)' })
      new AssigneesCell(tr.el, task.assignees)
      new ActionsCell(tr.el, { onClick: noop })
    }
  }
}

export function registerStyleguide(plugin: PMPlugin): void {
  plugin.registerView(PM_STYLEGUIDE_VIEW_TYPE, (leaf) => new StyleguideView(leaf))
  plugin.addCommand({
    id: 'open-styleguide',
    name: 'Open styleguide gallery',
    callback: safeAsync(async () => {
      // Opened directly rather than via plugin.router so no styleguide code
      // ends up in prod builds.
      const leaf = plugin.app.workspace.getLeaf('tab')
      await leaf.setViewState({ type: PM_STYLEGUIDE_VIEW_TYPE, state: {} })
      await plugin.app.workspace.revealLeaf(leaf)
    })
  })
}

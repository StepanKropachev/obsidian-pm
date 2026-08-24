import { ButtonComponent, ItemView, WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '../../main'
import {
  type PriorityConfig,
  type PriorityIconSet,
  type Task,
  DEFAULT_PRIORITIES,
  DEFAULT_STATUSES,
  PRIORITY_ICON_SETS,
  PRIORITY_ICON_SET_LABELS,
  makeTask
} from '../../types'
import { renderDueChip } from '../../ui/composites/dueChip'
import { renderTagChip } from '../../ui/composites/tagChip'
import { renderTimeChip } from '../../ui/composites/timeChip'
import { renderMetricStrip } from '../../ui/composites/metricStrip'
import { renderMilestoneTimeline } from '../../ui/composites/milestoneTimeline'
import { renderNoteLink } from '../../ui/composites/noteLink'
import { renderProjectChip } from '../../ui/composites/projectChip'
import { ActionsCell } from '../../ui/composites/cells/ActionsCell'
import { AssigneesCell } from '../../ui/composites/cells/AssigneesCell'
import { CustomFieldCell, type CustomFieldValue } from '../../ui/composites/cells/CustomFieldCell'
import { DueDateCell } from '../../ui/composites/cells/DueDateCell'
import { ExpandCell } from '../../ui/composites/cells/ExpandCell'
import { PriorityCell } from '../../ui/composites/cells/PriorityCell'
import { ProjectCell } from '../../ui/composites/cells/ProjectCell'
import { ProgressCell } from '../../ui/composites/cells/ProgressCell'
import { SelectCell } from '../../ui/composites/cells/SelectCell'
import { StatusCell } from '../../ui/composites/cells/StatusCell'
import { TimeCell } from '../../ui/composites/cells/TimeCell'
import { TitleCell } from '../../ui/composites/cells/TitleCell'
import { KanbanCard } from '../../ui/composites/KanbanCard'
import { ProjectRow } from '../../ui/composites/ProjectRow'
import { TaskRow } from '../../ui/composites/TaskRow'
import { renderAddButton } from '../../ui/composites/addButton'
import {
  renderAddProperty,
  renderDepRow,
  renderDateControl,
  renderIconControl,
  renderInputControl,
  renderMultiSelect,
  renderSelectControl
} from '../../ui/composites/properties'
import { renderPropRow } from '../../ui/FormField'
import { renderFilterDropdown } from '../../ui/FilterDropdown'
import { Avatar } from '../../ui/primitives/Avatar'
import { AvatarStack, type AvatarPerson } from '../../ui/primitives/AvatarStack'
import { Chip } from '../../ui/primitives/Chip'
import { Checkbox } from '../../ui/primitives/Checkbox'
import { CollapseToggle } from '../../ui/primitives/CollapseToggle'
import { EmptyState } from '../../ui/primitives/EmptyState'
import { IconButton } from '../../ui/primitives/IconButton'
import { ChipButton } from '../../ui/primitives/ChipButton'
import { Popover } from '../../ui/primitives/Popover'
import { ProgressBar } from '../../ui/primitives/ProgressBar'
import { SegmentedControl } from '../../ui/primitives/SegmentedControl'
import { ViewSwitcher } from '../../ui/primitives/ViewSwitcher'
import { renderPriorityBadge, renderStatusBadge, renderStatusDot } from '../../ui/StatusBadge'
import { displayName, priorityIcon, safeAsync } from '../../utils'

export const PM_STYLEGUIDE_VIEW_TYPE = 'pm-styleguide'

const noop = (): void => undefined
const noopAsync = (): Promise<void> => Promise.resolve()
const PEOPLE = ['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Margaret Hamilton', 'Edsger Dijkstra']
/** Five ranks, so every icon of a set shows. */
const FIVE_PRIORITIES: PriorityConfig[] = [
  ...DEFAULT_PRIORITIES,
  { id: 'trivial', label: 'Trivial', color: '#6ba8a0', icon: '' }
]
const WIKILINK_PERSON = '[[People/Alan Turing|Alan]]'
const SAMPLE_PEOPLE: AvatarPerson[] = [
  { name: 'Ada Lovelace' },
  { name: 'Alan', onClick: noop },
  { name: 'Ghost', unresolved: true }
]

/**
 * Gallery of every primitive and composite variant, in a real pane so the CSS cascade is
 * the one users get. Mock data only. Compiled in only when `__STYLEGUIDE__` is true;
 * the catalog is docs/styleguide.md.
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
    this.renderCheckbox()
    this.renderEmptyState()
    this.renderSegmented()
    this.renderViewSwitcher()
    this.renderPopover()
    this.group('Shared widgets')
    this.renderBadges()
    this.renderForm()
    this.group('Composites')
    this.renderDerivedChips()
    this.renderProjectRows()
    this.renderCards()
    this.renderMetricStrip()
    this.renderMilestoneTimeline()
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
    const filterRow = this.row(sec, 'renderFilterDropdown (options carry their palette icon)')
    renderFilterDropdown(
      filterRow,
      'Status',
      ['todo'],
      DEFAULT_STATUSES.map((s) => ({ id: s.id, label: s.label, icon: s.icon })),
      noop
    )
    renderFilterDropdown(
      filterRow,
      'Priority',
      [],
      FIVE_PRIORITIES.map((p) => ({
        id: p.id,
        label: p.label,
        icon: p.icon,
        namedIcon: priorityIcon(FIVE_PRIORITIES, p.id, 'chevrons')
      })),
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

  private renderCheckbox(): void {
    const sec = this.section('Checkbox', 'checkbox')
    const row = this.row(sec, 'unchecked / checked')
    new Checkbox(row).setAriaLabel('Unchecked example').onChange(noop)
    new Checkbox(row).setChecked(true).setAriaLabel('Checked example').onChange(noop)
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
    for (const iconSet of Object.keys(PRIORITY_ICON_SETS) as PriorityIconSet[]) {
      const prioRow = this.row(sec, `renderPriorityBadge (${PRIORITY_ICON_SET_LABELS[iconSet]})`)
      for (const priority of FIVE_PRIORITIES) {
        renderPriorityBadge(prioRow, makeTask({ priority: priority.id }), FIVE_PRIORITIES, iconSet, noop)
      }
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
    const selectRow = this.row(sec, 'renderSelectControl: set / empty')
    renderSelectControl({
      container: selectRow,
      value: DEFAULT_STATUSES[1].id,
      options: DEFAULT_STATUSES.map((s) => ({ id: s.id, label: s.label, color: s.color })),
      onChange: noop
    })
    renderSelectControl({ container: selectRow, value: null, options: [], placeholder: 'Select', onChange: noop })
    const dateRow = this.row(sec, 'renderDateControl: set with hint / empty')
    renderDateControl({
      container: dateRow,
      value: '2026-07-20',
      hint: { text: 'in 3 days', tone: 'soon' },
      onChange: noop
    })
    renderDateControl({ container: dateRow, value: '', onChange: noop })
    const inputRow = this.row(sec, 'renderInputControl: number / text / empty')
    renderInputControl({
      container: inputRow,
      value: '45',
      inputType: 'number',
      suffix: '%',
      number: { min: 0, max: 100 },
      onChange: noop
    })
    renderInputControl({ container: inputRow, value: 'Acme Corp', onChange: noop })
    renderInputControl({ container: inputRow, value: '', placeholder: 'Set value', onChange: noop })
    const iconRow = this.row(sec, 'renderIconControl: icon / emoji / empty')
    renderIconControl({ container: iconRow, value: 'circle-play', color: DEFAULT_STATUSES[1].color, onChange: noop })
    renderIconControl({ container: iconRow, value: '🚀', onChange: noop })
    renderIconControl({ container: iconRow, value: '', onChange: noop })
    const peopleRow = this.row(sec, 'renderMultiSelect: avatarStack, as the people picker uses it')
    const assigned = [PEOPLE[0], WIKILINK_PERSON]
    renderMultiSelect({
      container: peopleRow,
      avatarStack: true,
      search: true,
      addLabel: 'Assign',
      placeholder: 'Search people…',
      labelFor: displayName,
      keyOf: displayName,
      selected: () => assigned,
      options: () => PEOPLE.map((person) => ({ id: person, label: person })),
      moreOptions: (query) =>
        PEOPLE.filter((person) => person.toLowerCase().includes(query.toLowerCase())).map((person) => ({
          id: `[[People/${person}]]`,
          label: person
        })),
      moreHeading: 'People in your vault',
      add: (id) => {
        assigned.push(id)
      },
      remove: (id) => {
        assigned.splice(assigned.indexOf(id), 1)
      },
      createLabel: (name) => `Add "${name}"`,
      create: (name) => {
        assigned.push(name)
      },
      createAlt: { label: (name) => `Create person note "${name}"`, icon: 'user-plus', run: noopAsync }
    })
    const depsRow = this.row(sec, 'renderMultiSelect: depsList with linked titles')
    const depTitles: Record<string, string> = { 'task-1a2b': 'Draft the launch plan', 'task-9f8e': 'Sign off on copy' }
    renderMultiSelect({
      container: depsRow,
      addLabel: 'Add dependency',
      addLabelMore: 'Add another',
      depsList: true,
      labelFor: (id) => depTitles[id] ?? id,
      linkFor: (id) => ({ path: `Projects/Launch_tasks/${id}.md`, open: noop }),
      selected: () => Object.keys(depTitles),
      options: () => [],
      add: noop,
      remove: noop
    })
    const depRow = this.row(sec, 'renderDepRow: read-only, as Blocks shows it')
    renderDepRow(depRow.createDiv('pm-prop-deps'), {
      id: 'task-4c7d',
      title: 'Announce the release',
      tooltip: 'In Launch',
      link: { path: 'Projects/Launch_tasks/task-4c7d.md', open: noop }
    })
    const linkRow = this.row(sec, 'renderNoteLink: plain and as a done subtask')
    renderNoteLink(linkRow, { label: 'Draft the launch plan', path: 'Projects/Launch_tasks/task-1a2b.md', open: noop })
    renderNoteLink(linkRow, {
      label: 'Sign off on copy',
      path: 'Projects/Launch_tasks/task-9f8e.md',
      open: noop,
      cls: 'pm-subtask-title pm-subtask-title--done'
    })
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
    const projectRow = this.row(sec, 'renderProjectChip: plain / clickable')
    renderProjectChip(projectRow, { title: 'Platform', color: '#7a9ec4' })
    renderProjectChip(projectRow, { title: 'Website relaunch', color: '#8b72be', onClick: noop })
  }

  private renderProjectRows(): void {
    const sec = this.section('ProjectRow', 'project-row')
    sec.createDiv({
      cls: 'pm-sg-caption',
      text: 'The project list: a parent with its rolled-up counts, a child on a tree connector, and a collapsed one.'
    })
    const table = sec.createEl('table', { cls: 'pm-table pm-project-table' })
    const head = table.createEl('thead').createEl('tr')
    for (const column of ['', 'Project', 'Progress', 'Tasks', 'Members', 'Due', '']) {
      head.createEl('th', { text: column })
    }
    const tbody = table.createEl('tbody')
    new ProjectRow(tbody, {
      title: 'Platform',
      icon: '🚀',
      color: '#7a9ec4',
      depth: 0,
      treeGuides: [],
      isLastChild: false,
      childCount: 2,
      collapsed: false,
      tasksDone: 12,
      tasksTotal: 40,
      overdue: 0,
      members: SAMPLE_PEOPLE,
      dueLabel: 'Oct 30',
      dueUrgency: 'normal',
      onToggleCollapsed: noop,
      onClick: noop,
      onContextMenu: noop,
      onActions: noop
    })
    new ProjectRow(tbody, {
      title: 'Website relaunch',
      icon: '📋',
      color: '#8b72be',
      depth: 1,
      treeGuides: [true],
      isLastChild: true,
      childCount: 0,
      collapsed: false,
      tasksDone: 4,
      tasksTotal: 10,
      overdue: 3,
      members: [SAMPLE_PEOPLE[0]],
      dueLabel: 'Jun 20',
      dueUrgency: 'overdue',
      onToggleCollapsed: noop,
      onClick: noop,
      onContextMenu: noop,
      onActions: noop
    })
    new ProjectRow(tbody, {
      title: 'Internal tools',
      icon: '🛠',
      color: '#767491',
      depth: 0,
      treeGuides: [],
      isLastChild: true,
      childCount: 1,
      collapsed: true,
      tasksDone: 31,
      tasksTotal: 38,
      overdue: 0,
      members: [],
      dueLabel: '',
      dueUrgency: 'normal',
      onToggleCollapsed: noop,
      onClick: noop,
      onContextMenu: noop,
      onActions: noop
    })
  }

  private renderCards(): void {
    const sec = this.section('Cards', 'cards')
    const kanbanRow = this.row(sec, 'KanbanCard: plain / overdue milestone with everything')
    new KanbanCard(kanbanRow, {
      task: makeTask({ title: 'Write the launch announcement' }),
      people: [],
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
      people: SAMPLE_PEOPLE,
      priorityColor: '#c47070',
      descriptionPreview: 'Everything that must land before the announcement goes out.',
      parentTitle: 'Website relaunch',
      renderSource: (el) => renderProjectChip(el, { title: 'Platform', color: '#7a9ec4', onClick: noop }),
      loggedHours: 11,
      overdue: true,
      showTagColors: true,
      onClick: noop,
      onContextMenu: noop,
      onDragStart: noop,
      onDragEnd: noop
    })
  }

  private renderMetricStrip(): void {
    const sec = this.section('MetricStrip', 'metric-strip')
    const row = this.row(sec, 'four stats, one with a progress bar, one flagged')
    renderMetricStrip(row, [
      {
        label: 'Progress',
        value: '62%',
        sub: 'of 48 tasks',
        extra: (el) => {
          new ProgressBar(el).setSize('sm').setValue(62)
        }
      },
      { label: 'Tasks', value: '30 of 48', sub: 'done' },
      { label: 'Overdue', value: '4', sub: 'tasks past due', alert: true },
      {
        label: 'Time',
        value: '',
        sub: 'logged / estimate',
        extra: (el) => {
          renderTimeChip(el, 96, 140)
        }
      }
    ])
  }

  private renderMilestoneTimeline(): void {
    const sec = this.section('MilestoneTimeline', 'milestone-timeline')
    const row = this.row(sec, 'done / next / planned, with a crowded pair on the lower row')
    renderMilestoneTimeline(
      row,
      [
        { name: 'Feature freeze', dateLabel: "Jul 24, '26", pos: 4, state: 'done' },
        { name: 'Internal beta', dateLabel: "Aug 7, '26", pos: 30, state: 'done' },
        { name: 'Public beta', dateLabel: "Sep 12, '26", pos: 55, state: 'next' },
        { name: 'Store submission', dateLabel: "Sep 20, '26", pos: 62, state: 'plan' },
        { name: 'GA release', dateLabel: "Oct 30, '26", pos: 96, state: 'plan' }
      ],
      42
    )
  }

  private renderTable(): void {
    const sec = this.section('Table row and cells', 'table')
    sec.createDiv({
      cls: 'pm-sg-caption',
      text: 'TaskRow + one of each cell composite, with TitleCell tree connectors. ProjectCell only appears when a view covers several projects. CustomFieldCell takes plain text, or the links a value names.'
    })
    const table = sec.createEl('table', { cls: 'pm-table' })
    const tbody = table.createEl('tbody')
    const rows: {
      task: Task
      props: { depth: number; isDone: boolean; isSelected: boolean }
      tree: { guides: boolean[]; isLastChild: boolean }
      urgency: 'normal' | 'near' | 'overdue'
      time: { logged: number; estimate: number }
      custom: CustomFieldValue
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
        tree: { guides: [], isLastChild: false },
        urgency: 'normal',
        time: { logged: 5, estimate: 10 },
        custom: { kind: 'people', people: [{ name: 'Ada Lovelace', onClick: noop }] }
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
        tree: { guides: [false], isLastChild: false },
        urgency: 'overdue',
        time: { logged: 6, estimate: 4 },
        custom: { kind: 'links', links: [{ name: 'Missing Person', unresolved: true }] }
      },
      {
        task: makeTask({ title: 'Sweep the leftover copy', status: 'review', priority: 'low' }),
        props: { depth: 2, isDone: false, isSelected: false },
        tree: { guides: [true, false], isLastChild: true },
        urgency: 'normal',
        time: { logged: 1, estimate: 2 },
        custom: { kind: 'text', text: 'Rim road' }
      },
      {
        task: makeTask({ title: 'Archive old sprints', status: 'done', progress: 100 }),
        props: { depth: 1, isDone: true, isSelected: false },
        tree: { guides: [false], isLastChild: true },
        urgency: 'normal',
        time: { logged: 0, estimate: 0 },
        custom: { kind: 'checkbox', checked: true }
      }
    ]
    for (const { task, props, tree, urgency, time, custom } of rows) {
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
      new TitleCell(tr.el, {
        task,
        treeGuides: tree.guides,
        isLastChild: tree.isLastChild,
        showTagColors: true,
        onTitleClick: noop,
        onTitleSave: noopAsync,
        onAddSubtask: noop
      })
      new ProjectCell(tr.el, { title: 'Platform', color: '#7a9ec4' })
      new StatusCell(tr.el, { task, statuses: DEFAULT_STATUSES, onChange: noop })
      new PriorityCell(tr.el, { task, priorities: DEFAULT_PRIORITIES, priorityIcons: 'chevrons', onChange: noop })
      new DueDateCell(tr.el, { task, urgency, onSave: noopAsync })
      new TimeCell(tr.el, time)
      new ProgressCell(tr.el, { value: task.progress, color: 'var(--interactive-accent)', onSave: noopAsync })
      new AssigneesCell(tr.el, SAMPLE_PEOPLE)
      new CustomFieldCell(tr.el, custom)
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
      // Opened directly, not via plugin.router, so no styleguide code reaches prod builds.
      const leaf = plugin.app.workspace.getLeaf('tab')
      await leaf.setViewState({ type: PM_STYLEGUIDE_VIEW_TYPE, state: {} })
      await plugin.app.workspace.revealLeaf(leaf)
    })
  })
}

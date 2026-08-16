import { ButtonComponent, Component, ItemView, MarkdownRenderer, TFile, WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '../main'
import type { Project, ResolvedProjectConfig, Task } from '../types'
import { collectAllTags, flattenTasks, totalLoggedHours, type ProjectRef } from '../store'
import { Temporal, parsePlainDate, today } from '../dates'
import { formatDateLong, isTerminalStatus, safeAsync, truncateTitle } from '../utils'
import { Avatar, displayName } from '../ui/primitives/Avatar'
import { Chip } from '../ui/primitives/Chip'
import { EmptyState } from '../ui/primitives/EmptyState'
import { ProgressBar } from '../ui/primitives/ProgressBar'
import { renderPropRow } from '../ui/FormField'
import { renderDueChip, type DueUrgency } from '../ui/composites/dueChip'
import { renderMetricStrip, type MetricStat } from '../ui/composites/metricStrip'
import { renderMilestoneTimeline, type MilestonePoint } from '../ui/composites/milestoneTimeline'
import { renderTagChip } from '../ui/composites/tagChip'
import { renderTimeChip } from '../ui/composites/timeChip'

export const PM_PROJECT_OVERVIEW_VIEW_TYPE = 'pm-project-overview'

export interface ProjectOverviewState {
  filePath?: string
  [key: string]: unknown
}

const MAX_TAGS = 8

interface Rollup {
  total: number
  done: number
  overdue: number
  logged: number
  estimate: number
  latestDue: string
}

/**
 * One project's own page: where it stands, what it says, what sits under it. Read-only,
 * and always a single project - the task views are what cover several at once.
 */
export class ProjectOverviewView extends ItemView {
  plugin: PMPlugin
  private state: ProjectOverviewState = {}
  private project: Project | null = null
  private description = new Component()
  private container!: HTMLElement
  /** Parent and sub-projects as last drawn, so an unrelated index change doesn't repaint. */
  private treeSignature = ''

  constructor(leaf: WorkspaceLeaf, plugin: PMPlugin) {
    super(leaf)
    this.plugin = plugin
    this.navigation = false
  }

  getViewType(): string {
    return PM_PROJECT_OVERVIEW_VIEW_TYPE
  }
  getDisplayText(): string {
    return truncateTitle(this.project?.title ?? 'Project', 10)
  }
  getIcon(): string {
    return 'gauge'
  }

  async setState(state: ProjectOverviewState, result: unknown): Promise<void> {
    const changed = state.filePath !== this.state.filePath
    this.state = state
    if (changed || !this.project) await this.loadProject()
    await super.setState(state, result as import('obsidian').ViewStateResult)
  }

  getState(): ProjectOverviewState {
    return this.state
  }

  onOpen(): Promise<void> {
    this.containerEl.addClass('pm-view')
    this.contentEl.empty()
    this.contentEl.addClass('pm-root')
    this.container = this.contentEl.createDiv('pm-overview')
    this.register(
      this.plugin.store.onProjectChanged((path) => {
        if (path === this.project?.filePath) this.render()
      })
    )
    this.register(
      this.plugin.index.onChange(() => {
        if (this.project && this.treeSignature !== this.signTree(this.project)) this.render()
      })
    )
    return Promise.resolve()
  }

  onClose(): Promise<void> {
    this.description.unload()
    this.contentEl.empty()
    return Promise.resolve()
  }

  private async loadProject(): Promise<void> {
    const path = this.state.filePath
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null
    if (!(file instanceof TFile)) {
      this.project = null
      this.renderMissing()
      return
    }
    this.project = await this.plugin.store.loadProject(file)
    ;(this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.()
    if (!this.project) {
      this.renderMissing()
      return
    }
    this.render()
  }

  private renderMissing(): void {
    this.container.empty()
    new EmptyState(this.container)
      .setIcon('📋')
      .setTitle('No project here')
      .setBody('It may have been deleted or renamed.')
  }

  render(): void {
    const project = this.project
    if (!project) return
    this.container.empty()
    this.treeSignature = this.signTree(project)

    const config = this.plugin.store.configFor(project)
    const tasks = flattenTasks(project.tasks)
      .map((entry) => entry.task)
      .filter((task) => !task.archived)
    const rollup = summarize(tasks, config)

    this.renderBreadcrumbs(project)
    this.renderHeader(project, rollup)
    const grid = this.container.createDiv('pm-overview-grid')
    const main = grid.createDiv('pm-overview-main')
    const side = grid.createDiv('pm-overview-side')

    this.renderMetrics(main, project, rollup)
    this.renderDescription(main, project)
    this.renderMilestones(main, tasks, config)
    this.renderSubProjects(main, project)
    this.renderProperties(side, project, tasks, rollup)
  }

  private signTree(project: Project): string {
    const parent = this.plugin.index.parentOf(project.filePath)?.path ?? ''
    return `${parent}|${this.plugin.index
      .childRefs(project.filePath)
      .map((child) => child.path)
      .join(',')}`
  }

  private renderHeader(project: Project, rollup: Rollup): void {
    const header = this.container.createDiv('pm-overview-header')
    const tile = header.createDiv({ cls: 'pm-overview-icon', text: project.icon })
    tile.style.setProperty('--pm-overview-tint', project.color)

    const identity = header.createDiv('pm-overview-identity')
    identity.createDiv({ cls: 'pm-overview-title', text: project.title })
    const children = this.plugin.index.childRefs(project.filePath).length
    const bits = [`${rollup.done} of ${rollup.total} tasks done`]
    if (children) bits.push(children === 1 ? '1 sub-project' : `${children} sub-projects`)
    if (project.teamMembers.length) bits.push(`${project.teamMembers.length} members`)
    identity.createDiv({ cls: 'pm-overview-subline', text: bits.join(' · ') })

    new ButtonComponent(header)
      .setButtonText('Edit project')
      .onClick(safeAsync(() => this.plugin.router.openProjectEdit(project.filePath, this.leaf)))
    new ButtonComponent(header)
      .setButtonText('Open tasks')
      .setCta()
      .onClick(safeAsync(() => this.plugin.router.openScope({ kind: 'project', path: project.filePath }, this.leaf)))
  }

  private section(parent: HTMLElement, title: string, note = ''): HTMLElement {
    const section = parent.createDiv('pm-overview-section')
    const head = section.createDiv('pm-overview-section-head')
    head.createSpan({ cls: 'pm-section-label', text: title })
    if (note) head.createSpan({ cls: 'pm-overview-note', text: note })
    return section
  }

  private renderBreadcrumbs(project: Project): void {
    const chain: ProjectRef[] = []
    for (let ref = this.plugin.index.parentOf(project.filePath); ref; ref = this.plugin.index.parentOf(ref.path)) {
      chain.unshift(ref)
    }
    if (chain.length === 0) return
    const bar = this.container.createDiv('pm-overview-crumbs')
    for (const crumb of chain) {
      const link = bar.createSpan({ cls: 'pm-overview-crumb', text: crumb.title })
      link.addEventListener(
        'click',
        safeAsync(() => this.plugin.router.openProjectOverview(crumb.path))
      )
      bar.createSpan({ cls: 'pm-overview-crumb-sep', text: '/' })
    }
    bar.createSpan({ text: project.title })
  }

  private renderMetrics(parent: HTMLElement, project: Project, rollup: Rollup): void {
    const percent = rollup.total ? (rollup.done / rollup.total) * 100 : 0
    const stats: MetricStat[] = [
      {
        label: 'Progress',
        value: `${Math.round(percent)}%`,
        sub: `of ${rollup.total} ${rollup.total === 1 ? 'task' : 'tasks'}`,
        extra: (el) => {
          new ProgressBar(el).setSize('sm').setValue(percent).setColor(project.color)
        }
      },
      { label: 'Tasks', value: `${rollup.done} of ${rollup.total}`, sub: 'done' },
      { label: 'Overdue', value: String(rollup.overdue), sub: 'tasks past due', alert: rollup.overdue > 0 },
      {
        label: 'Time',
        value: rollup.logged || rollup.estimate ? '' : '—',
        sub: 'logged / estimate',
        extra: (el) => {
          renderTimeChip(el, rollup.logged, rollup.estimate)
        }
      }
    ]
    renderMetricStrip(parent, stats)
  }

  private renderDescription(parent: HTMLElement, project: Project): void {
    const section = this.section(parent, 'Description')
    const body = section.createDiv('pm-overview-description')
    void this.hydrateDescription(project, body)
  }

  /** The project's own note body, which is only read from disk when something asks for it. */
  private async hydrateDescription(project: Project, host: HTMLElement): Promise<void> {
    await this.plugin.store.loadProjectBody(project)
    if (!host.isConnected) return
    host.empty()
    if (!project.description.trim()) {
      host.createDiv({ cls: 'pm-overview-muted', text: 'No description.' })
      return
    }
    this.description.unload()
    this.description = new Component()
    this.description.load()
    await MarkdownRenderer.render(this.plugin.app, project.description, host, project.filePath, this.description)
  }

  private renderMilestones(parent: HTMLElement, tasks: Task[], config: ResolvedProjectConfig): void {
    const dated: { task: Task; date: Temporal.PlainDate }[] = []
    for (const task of tasks) {
      if (task.type !== 'milestone') continue
      const date = parsePlainDate(task.due)
      if (date) dated.push({ task, date })
    }
    dated.sort((a, b) => Temporal.PlainDate.compare(a.date, b.date))

    const done = dated.filter((entry) => isTerminalStatus(entry.task.status, config.statuses)).length
    const note = dated.length ? `${done} of ${dated.length} done` : ''
    const section = this.section(parent, 'Milestones', note)
    if (dated.length === 0) {
      section.createDiv({ cls: 'pm-overview-muted', text: 'No milestones.' })
      return
    }

    const now = today()
    const first = dated[0].date
    const last = dated[dated.length - 1].date
    const lo = Temporal.PlainDate.compare(now, first) < 0 ? now : first
    const hi = Temporal.PlainDate.compare(now, last) > 0 ? now : last
    const span = Math.max(lo.until(hi, { largestUnit: 'day' }).days, 1)
    const pad = Math.max(Math.round(span * 0.06), 1)
    const start = lo.subtract({ days: pad })
    const total = span + pad * 2
    const posOf = (date: Temporal.PlainDate): number =>
      Math.round((start.until(date, { largestUnit: 'day' }).days / total) * 1000) / 10

    let nextTaken = false
    const points: MilestonePoint[] = dated.map((entry) => {
      let state: MilestonePoint['state'] = 'plan'
      if (isTerminalStatus(entry.task.status, config.statuses)) {
        state = 'done'
      } else if (!nextTaken) {
        state = 'next'
        nextTaken = true
      }
      return { name: entry.task.title, dateLabel: formatDateLong(entry.task.due), pos: posOf(entry.date), state }
    })
    renderMilestoneTimeline(section, points, posOf(now))
  }

  private renderSubProjects(parent: HTMLElement, project: Project): void {
    const children = this.plugin.index.childRefs(project.filePath)
    if (children.length === 0) return
    const section = this.section(parent, 'Sub-projects')
    for (const child of children) {
      const { total, done } = this.plugin.index.rollupCounts(child)
      const row = section.createDiv('pm-overview-child')
      row.createSpan({ cls: 'pm-overview-child-icon', text: child.icon })
      row.createSpan({ cls: 'pm-overview-child-title', text: child.title })
      new ProgressBar(row)
        .setSize('sm')
        .setValue(total ? (done / total) * 100 : 0)
        .setColor(child.color)
        .setShowLabel(true)
      row.createSpan({ cls: 'pm-overview-child-count', text: `${done}/${total}` })
      row.addEventListener(
        'click',
        safeAsync(() => this.plugin.router.openProjectOverview(child.path))
      )
    }
  }

  private renderProperties(parent: HTMLElement, project: Project, tasks: Task[], rollup: Rollup): void {
    const section = this.section(parent, 'Properties')
    const list = section.createDiv('pm-overview-props')

    renderPropRow(list, 'Members', () => {
      const value = createDiv('pm-prop-value')
      if (project.teamMembers.length === 0) {
        value.createSpan({ cls: 'pm-overview-muted', text: 'No members' })
        return value
      }
      for (const member of project.teamMembers) {
        const holder = value.createSpan({ cls: 'pm-overview-member' })
        new Avatar(holder).setName(member).setSize('sm')
        holder.createSpan({ text: displayName(member) })
      }
      return value
    })

    const tags = collectAllTags(project.tasks)
    renderPropRow(list, 'Tags', () => {
      const value = createDiv('pm-prop-value')
      if (tags.length === 0) {
        value.createSpan({ cls: 'pm-overview-muted', text: 'No tags' })
        return value
      }
      for (const tag of tags.slice(0, MAX_TAGS)) renderTagChip(value, tag, this.plugin.settings.showTagColors)
      if (tags.length > MAX_TAGS) {
        value.createSpan({ cls: 'pm-overview-muted', text: `+${tags.length - MAX_TAGS}` })
      }
      return value
    })

    renderPropRow(list, 'Latest due', () => {
      const value = createDiv('pm-prop-value')
      if (!rollup.latestDue) {
        value.createSpan({ cls: 'pm-overview-muted', text: 'No dates' })
        return value
      }
      renderDueChip(value, formatDateLong(rollup.latestDue), urgencyOf(rollup.latestDue, rollup.overdue > 0))
      return value
    })

    renderPropRow(list, 'Time', () => {
      const value = createDiv('pm-prop-value')
      const chip = renderTimeChip(value, rollup.logged, rollup.estimate)
      if (!chip) value.createSpan({ cls: 'pm-overview-muted', text: 'No estimate' })
      return value
    })

    const parentRef = this.plugin.index.parentOf(project.filePath)
    renderPropRow(list, 'Parent', () => {
      const value = createDiv('pm-prop-value')
      if (!parentRef) {
        value.createSpan({ cls: 'pm-overview-muted', text: 'No parent' })
        return value
      }
      const link = value.createSpan({ cls: 'pm-overview-crumb', text: parentRef.title })
      link.addEventListener(
        'click',
        safeAsync(() => this.plugin.router.openProjectOverview(parentRef.path))
      )
      return value
    })

    renderPropRow(list, 'Assignees', () => {
      const value = createDiv('pm-prop-value')
      const names = new Set(tasks.flatMap((task) => task.assignees).filter(Boolean))
      if (names.size === 0) {
        value.createSpan({ cls: 'pm-overview-muted', text: 'Nobody assigned' })
        return value
      }
      for (const name of names) {
        new Chip(value).setLabel(displayName(name)).setVariant('outline').setShape('pill').setSize('sm')
      }
      return value
    })

    if (project.customFields.length === 0) return
    const fields = this.section(parent, 'Custom fields')
    const fieldList = fields.createDiv('pm-overview-props')
    for (const field of project.customFields) {
      renderPropRow(fieldList, field.name, () => {
        const value = createDiv('pm-prop-value')
        value.createSpan({ cls: 'pm-overview-muted', text: field.type })
        return value
      })
    }
  }
}

function summarize(tasks: Task[], config: ResolvedProjectConfig): Rollup {
  const now = today()
  const rollup: Rollup = { total: 0, done: 0, overdue: 0, logged: 0, estimate: 0, latestDue: '' }
  for (const task of tasks) {
    rollup.total++
    rollup.logged += totalLoggedHours(task)
    rollup.estimate += task.timeEstimate ?? 0
    const complete = isTerminalStatus(task.status, config.statuses)
    if (complete) rollup.done++
    const due = parsePlainDate(task.due)
    if (!due) continue
    if (task.due > rollup.latestDue) rollup.latestDue = task.due
    if (!complete && Temporal.PlainDate.compare(due, now) < 0) rollup.overdue++
  }
  rollup.logged = Math.round(rollup.logged * 10) / 10
  rollup.estimate = Math.round(rollup.estimate * 10) / 10
  return rollup
}

function urgencyOf(due: string, hasOverdue: boolean): DueUrgency {
  const date = parsePlainDate(due)
  if (!date) return 'normal'
  const days = today().until(date, { largestUnit: 'day' }).days
  if (days < 0) return hasOverdue ? 'overdue' : 'normal'
  return days < 3 ? 'near' : 'normal'
}

import type PMPlugin from '../main'
import type { Project } from '../types'
import type { ArchiveCandidate } from '../store'
import { collectArchivable, withoutBlockedDependents } from '../store'
import { today } from '../dates'
import { isTerminalStatus, safeAsync } from '../utils'

const CHECK_INTERVAL_MS = 60 * 60 * 1000

export interface ArchivePlan {
  project: Project
  rootIds: string[]
  tasks: number
}

/**
 * Moves tasks that have been complete for longer than their project's window into its
 * archive folder. The pass is keyed on the date rather than on elapsed time, so a vault
 * that stayed closed for a week catches up the next time it opens.
 */
export class AutoArchiver {
  private running = false

  constructor(private plugin: PMPlugin) {}

  /** The first pass runs once the index is built; this only schedules the later ones. */
  start(): void {
    this.plugin.registerInterval(
      window.setInterval(
        safeAsync(() => this.check()),
        CHECK_INTERVAL_MS
      )
    )
  }

  /** The daily pass over every project that has a window set. */
  async check(): Promise<void> {
    const settings = this.plugin.settings
    const configured = this.plugin.index
      .projectRefs()
      .some((ref) => (ref.autoArchiveDays ?? settings.autoArchiveDays) > 0)
    if (!configured) return

    const stamp = today().toString()
    if (settings.lastAutoArchiveDate === stamp || this.running) return
    this.running = true
    try {
      const plans = await this.plan(this.plugin.index.projectPaths(), false)
      const tasks = await this.apply(plans)
      settings.lastAutoArchiveDate = stamp
      await this.plugin.saveSettings()
      if (tasks) this.plugin.showNotice(`Archived ${tasks} completed task(s) in ${plans.length} project(s).`)
    } finally {
      this.running = false
    }
  }

  /**
   * Which tasks would move, one entry per project. The index says whether a project holds
   * anything old enough, so only the projects that do are loaded. `includeDisabled` covers
   * the command, where a project with no window archives everything it has finished.
   *
   * Dependencies are settled across the whole plan rather than project by project, because
   * a task can wait on one in another project.
   */
  async plan(projectPaths: string[], includeDisabled: boolean): Promise<ArchivePlan[]> {
    const entries: { project: Project; candidate: ArchiveCandidate }[] = []
    for (const path of projectPaths) {
      const ref = this.plugin.index.projectRef(path)
      if (!ref) continue
      const days = ref.autoArchiveDays ?? this.plugin.settings.autoArchiveDays
      if (days === 0 && !includeDisabled) continue
      const cutoff = today().subtract({ days }).toString()

      const complete = this.plugin.index.completeStatuses(ref)
      const anyOldEnough = this.plugin.index
        .taskRefs(path)
        .some((task) => !task.archived && complete.has(task.status) && !!task.completed && task.completed <= cutoff)
      if (!anyOldEnough) continue

      const project = await this.plugin.store.loadProjectByPath(path)
      if (!project) continue
      const statuses = this.plugin.store.configFor(project).statuses
      for (const candidate of collectArchivable(project, (status) => isTerminalStatus(status, statuses), cutoff)) {
        entries.push({ project, candidate })
      }
    }

    const kept = new Set(
      withoutBlockedDependents(
        entries.map((entry) => entry.candidate),
        this.plugin.index
      ).map((candidate) => candidate.rootId)
    )

    const plans = new Map<Project, ArchivePlan>()
    for (const { project, candidate } of entries) {
      if (!kept.has(candidate.rootId)) continue
      const plan = plans.get(project) ?? { project, rootIds: [], tasks: 0 }
      plan.rootIds.push(candidate.rootId)
      plan.tasks += candidate.ids.length
      plans.set(project, plan)
    }
    return [...plans.values()]
  }

  /** Returns how many tasks moved. */
  async apply(plans: ArchivePlan[]): Promise<number> {
    let tasks = 0
    for (const plan of plans) {
      await this.plugin.store.archiveTasks(plan.project, plan.rootIds)
      tasks += plan.tasks
    }
    return tasks
  }
}

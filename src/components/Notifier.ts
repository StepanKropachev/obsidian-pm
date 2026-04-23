import { Notice } from 'obsidian'
import type PMPlugin from '../main'
import type { Project } from '../types'
import { flattenTasks } from '../store/TaskTreeOps'
import { isTerminalStatus } from '../utils'
import { Temporal, today, parsePlainDate } from '../dates'

const CHECK_INTERVAL_MS = 60 * 60 * 1000 // check every hour

export class Notifier {
  private intervalId: number | null = null
  private notifiedIds = new Set<string>() // prevent repeat notifications within session

  constructor(private plugin: PMPlugin) {}

  start(): void {
    void this.check()
    this.intervalId = activeWindow.setInterval(() => {
      void this.check()
    }, CHECK_INTERVAL_MS)
    this.plugin.registerInterval(this.intervalId)
  }

  stop(): void {
    if (this.intervalId !== null) {
      activeWindow.clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  async check(): Promise<void> {
    if (!this.plugin.settings.notificationsEnabled) return

    const leadDays = this.plugin.settings.notificationLeadDays
    const now = today()
    const threshold = now.add({ days: leadDays })

    let projects: Project[]
    try {
      projects = await this.plugin.store.loadAllProjects(this.plugin.settings.projectsFolder)
    } catch {
      return
    }

    for (const project of projects) {
      const flat = flattenTasks(project.tasks)
      for (const { task } of flat) {
        const due = parsePlainDate(task.due)
        if (!due) continue
        if (isTerminalStatus(task.status, this.plugin.settings.statuses)) continue

        const cmpToToday = Temporal.PlainDate.compare(due, now)
        const isOverdue = cmpToToday < 0
        const isDueSoon = cmpToToday >= 0 && Temporal.PlainDate.compare(due, threshold) <= 0

        const notifKey = `${task.id}-${task.due}`

        if (isOverdue && !this.notifiedIds.has(notifKey + '-overdue')) {
          this.notifiedIds.add(notifKey + '-overdue')
          const daysAgo = now.since(due, { largestUnit: 'days' }).days
          new Notice(`⚠️ Overdue: "${task.title}" in ${project.title} was due ${daysAgo}d ago`, 8000)
        } else if (isDueSoon && !this.notifiedIds.has(notifKey + '-soon')) {
          this.notifiedIds.add(notifKey + '-soon')
          const daysLeft = due.since(now, { largestUnit: 'days' }).days
          const msg =
            daysLeft === 0
              ? `📅 Due today: "${task.title}" in ${project.title}`
              : `📅 Due in ${daysLeft}d: "${task.title}" in ${project.title}`
          new Notice(msg, 6000)
        }
      }
    }
  }
}

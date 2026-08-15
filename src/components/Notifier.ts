import { Notice } from 'obsidian'
import type PMPlugin from '../main'
import { Temporal, today, parsePlainDate } from '../dates'

const CHECK_INTERVAL_MS = 60 * 60 * 1000 // check every hour

export class Notifier {
  private intervalId: number | null = null
  private notifiedIds = new Set<string>() // prevent repeat notifications within session

  constructor(private plugin: PMPlugin) {}

  /** The first sweep runs once the index is built; this only schedules the later ones. */
  start(): void {
    this.intervalId = window.setInterval(() => {
      this.check()
    }, CHECK_INTERVAL_MS)
    this.plugin.registerInterval(this.intervalId)
  }

  stop(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  /** Reads due dates from the index, so an hourly sweep loads nothing. */
  check(): void {
    if (!this.plugin.settings.notificationsEnabled) return

    const leadDays = this.plugin.settings.notificationLeadDays
    const now = today()
    const threshold = now.add({ days: leadDays })

    for (const project of this.plugin.index.projectRefs()) {
      const complete = this.plugin.index.completeStatuses(project)
      for (const task of this.plugin.index.taskRefs(project.path)) {
        const due = parsePlainDate(task.due)
        if (!due) continue
        if (task.archived || complete.has(task.status)) continue

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

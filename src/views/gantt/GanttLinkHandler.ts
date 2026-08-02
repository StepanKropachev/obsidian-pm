import { Notice } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project, Task } from '../../types'
import { safeAsync } from '../../utils'

export interface LinkState {
  active: boolean
  taskId: string | null
  side: 'left' | 'right' | null
  dotEl: SVGElement | null
}

export function makeLinkState(): LinkState {
  return { active: false, taskId: null, side: null, dotEl: null }
}

/** Resets the state and clears the highlight on the active dot. */
export function cancelLink(link: LinkState): void {
  if (link.dotEl) link.dotEl.classList.remove('pm-gantt-link-dot--active')
  link.active = false
  link.taskId = null
  link.side = null
  link.dotEl = null
}

/** Returns true if a dependency was created, meaning the caller should refresh. */
export function handleLinkDotClick(
  dotEl: SVGElement,
  taskId: string,
  side: 'left' | 'right',
  link: LinkState,
  plugin: PMPlugin,
  project: Project,
  onRefresh: () => Promise<void>
): void {
  if (!link.active) {
    link.active = true
    link.taskId = taskId
    link.side = side
    link.dotEl = dotEl
    dotEl.classList.add('pm-gantt-link-dot--active')
    return
  }

  if (link.taskId === taskId) {
    cancelLink(link)
    return
  }

  const otherTaskId = link.taskId
  if (otherTaskId === null) {
    cancelLink(link)
    return
  }

  if (link.side === side) {
    new Notice('Connect a right dot (output) to a left dot (input).')
    return
  }

  // Finish-to-start: the right dot is the predecessor, and the successor (left dot)
  // is the one that carries the dependency.
  const predecessorId = side === 'right' ? taskId : otherTaskId
  const successorId = side === 'left' ? taskId : otherTaskId

  cancelLink(link)

  const allTasks = flattenAll(project.tasks)
  const successor = allTasks.find((t) => t.id === successorId)
  if (successor?.dependencies?.includes(predecessorId)) {
    new Notice('This dependency already exists.')
    return
  }

  // The reverse edge would close a cycle.
  const predecessor = allTasks.find((t) => t.id === predecessorId)
  if (predecessor?.dependencies?.includes(successorId)) {
    new Notice('Reverse dependency exists — would create a cycle.')
    return
  }

  const deps = [...(successor?.dependencies ?? []), predecessorId]
  void safeAsync(async () => {
    try {
      await plugin.store.updateTask(project, successorId, { dependencies: deps })
    } catch (err) {
      new Notice('Failed to save dependency.')
      console.error('GanttLinkHandler: save failed', err)
      return
    }
    await plugin.store.scheduleAfterChange(project, successorId)
    await onRefresh()
  })()
}

// Local copy: importing TaskTreeOps here would be circular.
function flattenAll(tasks: Task[]): Task[] {
  const result: Task[] = []
  const walk = (list: Task[]) => {
    for (const t of list) {
      result.push(t)
      if (t.subtasks.length) walk(t.subtasks)
    }
  }
  walk(tasks)
  return result
}

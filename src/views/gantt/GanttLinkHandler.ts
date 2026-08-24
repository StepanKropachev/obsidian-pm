import { Notice } from 'obsidian'
import type PMPlugin from '../../main'
import type { ProjectScope } from '../../store'
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
  scope: ProjectScope,
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

  // The two bars can belong to different projects, so the dependency is written to the
  // successor's own project rather than to whichever bar was clicked last.
  const successor = scope.taskById(successorId)
  const project = scope.projectOf(successorId)
  if (!successor || !project) {
    new Notice('That task is no longer in this view.')
    return
  }

  if (successor.dependencies.includes(predecessorId)) {
    new Notice('This dependency already exists.')
    return
  }

  // A predecessor chain can leave this project and come back, so the check spans the vault.
  if (plugin.index.wouldCreateCycle(successorId, predecessorId)) {
    new Notice('That link would create a dependency cycle.')
    return
  }

  const deps = [...successor.dependencies, predecessorId]
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

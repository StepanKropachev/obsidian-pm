import { Notice } from 'obsidian';
import type PMPlugin from '../../main';
import type { Project } from '../../types';
import { safeAsync } from '../../utils';

export interface LinkState {
  active: boolean;
  taskId: string | null;
  side: 'left' | 'right' | null;
  dotEl: SVGElement | null;
}

export function makeLinkState(): LinkState {
  return { active: false, taskId: null, side: null, dotEl: null };
}

/**
 * Cancel linking mode: reset state and remove highlight from the active dot.
 */
export function cancelLink(link: LinkState): void {
  if (link.dotEl) link.dotEl.classList.remove('pm-gantt-link-dot--active');
  link.active = false;
  link.taskId = null;
  link.side = null;
  link.dotEl = null;
}

/**
 * Handle a click on a link dot. Returns true if a dependency was created
 * (caller should refresh).
 */
export function handleLinkDotClick(
  dotEl: SVGElement,
  taskId: string,
  side: 'left' | 'right',
  link: LinkState,
  plugin: PMPlugin,
  project: Project,
  onRefresh: () => Promise<void>,
): void {
  // Nothing active yet — start linking
  if (!link.active) {
    link.active = true;
    link.taskId = taskId;
    link.side = side;
    link.dotEl = dotEl;
    dotEl.classList.add('pm-gantt-link-dot--active');
    return;
  }

  // Same task — cancel
  if (link.taskId === taskId) {
    cancelLink(link);
    return;
  }

  // Same side — invalid (need one left + one right)
  if (link.side === side) {
    new Notice('Connect a right dot (output) to a left dot (input).');
    return;
  }

  // Determine predecessor (right dot) and successor (left dot)
  // Finish-to-start: successor.dependencies includes predecessor.id
  const predecessorId = side === 'right' ? taskId : link.taskId!;
  const successorId = side === 'left' ? taskId : link.taskId!;

  cancelLink(link);

  // Check for duplicate
  const allTasks = flattenAll(project.tasks);
  const successor = allTasks.find(t => t.id === successorId);
  if (successor?.dependencies?.includes(predecessorId)) {
    new Notice('This dependency already exists.');
    return;
  }

  // Check for reverse (would create cycle)
  const predecessor = allTasks.find(t => t.id === predecessorId);
  if (predecessor?.dependencies?.includes(successorId)) {
    new Notice('Reverse dependency exists — would create a cycle.');
    return;
  }

  // Save
  const deps = [...(successor?.dependencies ?? []), predecessorId];
  void safeAsync(async () => {
    try {
      await plugin.store.updateTask(project, successorId, { dependencies: deps });
    } catch (err) {
      new Notice('Failed to save dependency.');
      console.error('GanttLinkHandler: save failed', err);
      return;
    }
    if (plugin.settings.autoSchedule) {
      await plugin.store.scheduleAfterChange(project, successorId);
    }
    await onRefresh();
  })();
}

// Simple flatten helper (avoids circular import with TaskTreeOps)
import type { Task } from '../../types';
function flattenAll(tasks: Task[]): Task[] {
  const result: Task[] = [];
  const walk = (list: Task[]) => {
    for (const t of list) {
      result.push(t);
      if (t.subtasks.length) walk(t.subtasks);
    }
  };
  walk(tasks);
  return result;
}

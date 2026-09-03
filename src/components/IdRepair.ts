import { TFile } from 'obsidian'
import type PMPlugin from '../main'
import type { ProjectRef, TaskRef } from '../store'
import { safeAsync } from '../utils'

const DEBOUNCE_MS = 5000

export interface IdRepairPlan {
  projectPath: string
  taskIds: string[]
  newProjectId: boolean
}

/**
 * Which projects give up which duplicated ids. The project whose note file is oldest
 * keeps its ids, so an existing dependency from elsewhere in the vault keeps pointing at
 * the task it was created against; ties go to the lexically smaller path. A group whose
 * note files can't all be found yet is left for a later pass, since a folder being copied
 * in shows up file by file.
 */
export function planIdRepairs(
  taskCollisions: Map<string, TaskRef[]>,
  projectCollisions: Map<string, ProjectRef[]>,
  noteCtime: (projectPath: string) => number | null
): IdRepairPlan[] {
  const keeperOf = (paths: string[]): string | null => {
    let keeper: string | null = null
    let keeperTime = Infinity
    for (const path of new Set(paths)) {
      const time = noteCtime(path)
      if (time === null) return null
      if (time < keeperTime || (time === keeperTime && keeper !== null && path < keeper)) {
        keeper = path
        keeperTime = time
      }
    }
    return keeper
  }

  const taskIdsByProject = new Map<string, Set<string>>()
  for (const [id, refs] of taskCollisions) {
    const paths = refs.map((ref) => ref.projectPath).filter((path): path is string => path !== null)
    const keeper = keeperOf(paths)
    if (!keeper) continue
    for (const path of paths) {
      if (path === keeper) continue
      const bucket = taskIdsByProject.get(path)
      if (bucket) bucket.add(id)
      else taskIdsByProject.set(path, new Set([id]))
    }
  }

  const newProjectIds = new Set<string>()
  for (const [, refs] of projectCollisions) {
    const keeper = keeperOf(refs.map((ref) => ref.path))
    if (!keeper) continue
    for (const ref of refs) {
      if (ref.path !== keeper) newProjectIds.add(ref.path)
    }
  }

  const plans = new Map<string, IdRepairPlan>()
  for (const [projectPath, ids] of taskIdsByProject) {
    plans.set(projectPath, { projectPath, taskIds: [...ids], newProjectId: newProjectIds.has(projectPath) })
  }
  for (const projectPath of newProjectIds) {
    if (!plans.has(projectPath)) plans.set(projectPath, { projectPath, taskIds: [], newProjectId: true })
  }
  return [...plans.values()]
}

/**
 * Copying a project's folder on disk duplicates the project id and every task id in it,
 * and everything resolved vault-wide by id then answers for the wrong copy: edits in a
 * multi-project view, dependency lookups, cycle checks, archiving. This sweep watches the
 * index, gives the newer copy fresh ids, and leaves the original as it was.
 */
export class IdRepair {
  private timer: number | null = null
  private running = false

  constructor(private plugin: PMPlugin) {}

  /** The first pass runs from the startup sweep; this catches copies made while the app is open. */
  start(): void {
    this.plugin.register(this.plugin.index.onChange(() => this.schedule()))
    this.plugin.register(() => {
      if (this.timer !== null) window.clearTimeout(this.timer)
    })
  }

  private schedule(): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(
      safeAsync(() => {
        this.timer = null
        return this.check()
      }),
      DEBOUNCE_MS
    )
  }

  async check(): Promise<void> {
    if (this.running || !this.plugin.index.ready) return
    this.running = true
    try {
      const plans = planIdRepairs(
        this.plugin.index.findTaskIdCollisions(),
        this.plugin.index.findProjectIdCollisions(),
        (path) => this.noteCtime(path)
      )
      for (const plan of plans) {
        const project = await this.plugin.store.loadProjectByPath(plan.projectPath)
        if (!project) continue
        await this.plugin.store.reassignIds(project, plan.taskIds, plan.newProjectId)
        this.plugin.showNotice(`Repaired duplicated ids in "${project.title}" (copied project).`)
      }
    } finally {
      this.running = false
    }
  }

  private noteCtime(path: string): number | null {
    const file = this.plugin.app.vault.getAbstractFileByPath(path)
    return file instanceof TFile ? file.stat.ctime : null
  }
}

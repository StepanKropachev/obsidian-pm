import { TFile, type WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '../main'
import type { ScopeSpec } from '../store'
import { PM_DASHBOARD_VIEW_TYPE } from './DashboardView'
import { PM_PROJECT_CREATE_VIEW_TYPE } from './ProjectCreateView'
import { PM_PROJECT_EDIT_VIEW_TYPE } from './ProjectEditView'
import { PM_PROJECT_OVERVIEW_VIEW_TYPE } from './ProjectOverviewView'
import { PM_PROJECT_VIEW_TYPE } from './ProjectView'
import { PM_TASK_VIEW_TYPE, type TaskViewState } from './TaskView'

export class PMViewRouter {
  constructor(private plugin: PMPlugin) {}

  async openDashboard(): Promise<void> {
    const ws = this.plugin.app.workspace
    const leaf = ws.getLeaf('tab')
    await leaf.setViewState({ type: PM_DASHBOARD_VIEW_TYPE, state: {} })
    await ws.revealLeaf(leaf)
  }

  async openProject(file: TFile): Promise<void> {
    await this.openScope({ kind: 'project', path: file.path })
  }

  /** The task views. Pass a leaf to navigate within it instead of opening a tab. */
  async openScope(scope: ScopeSpec, leaf?: WorkspaceLeaf): Promise<void> {
    const ws = this.plugin.app.workspace
    const target = leaf ?? ws.getLeaf('tab')
    await target.setViewState({ type: PM_PROJECT_VIEW_TYPE, state: { scope } })
    await ws.revealLeaf(target)
  }

  /** One project's own page, which is where opening a project lands. */
  async openProjectOverview(path: string, leaf?: WorkspaceLeaf): Promise<void> {
    const ws = this.plugin.app.workspace
    const target = leaf ?? ws.getLeaf('tab')
    await target.setViewState({ type: PM_PROJECT_OVERVIEW_VIEW_TYPE, state: { filePath: path } })
    await ws.revealLeaf(target)
  }

  /** The form for a project that does not exist yet; it writes nothing until submitted. */
  async openProjectCreate(leaf?: WorkspaceLeaf): Promise<void> {
    const ws = this.plugin.app.workspace
    const target = leaf ?? ws.getLeaf('tab')
    await target.setViewState({ type: PM_PROJECT_CREATE_VIEW_TYPE, state: {} })
    await ws.revealLeaf(target)
  }

  /** That project's settings. */
  async openProjectEdit(path: string, leaf?: WorkspaceLeaf): Promise<void> {
    const ws = this.plugin.app.workspace
    const target = leaf ?? ws.getLeaf('tab')
    await target.setViewState({ type: PM_PROJECT_EDIT_VIEW_TYPE, state: { filePath: path } })
    await ws.revealLeaf(target)
  }

  async openTask(state: TaskViewState): Promise<void> {
    const ws = this.plugin.app.workspace
    const leaf = ws.getLeaf('tab')
    await leaf.setViewState({ type: PM_TASK_VIEW_TYPE, state })
    await ws.revealLeaf(leaf)
  }

  async openProjectByPath(path: string): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(path)
    if (file instanceof TFile) await this.openProject(file)
  }
}

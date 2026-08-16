import { TFile, type WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '../main'
import type { ScopeSpec } from '../store'
import { PM_DASHBOARD_VIEW_TYPE } from './DashboardView'
import { PM_PROJECT_EDIT_VIEW_TYPE } from './ProjectEditView'
import { PM_PROJECT_OVERVIEW_VIEW_TYPE } from './ProjectOverviewView'
import { PM_PROJECT_VIEW_TYPE } from './ProjectView'
import { PM_TASK_VIEW_TYPE, type TaskViewState } from './TaskView'

export class PMViewRouter {
  constructor(private plugin: PMPlugin) {}

  /** Pass a leaf to navigate within it instead of opening a tab. */
  private async open(type: string, state: Record<string, unknown>, leaf?: WorkspaceLeaf): Promise<void> {
    const ws = this.plugin.app.workspace
    const target = leaf ?? ws.getLeaf('tab')
    await target.setViewState({ type, state })
    await ws.revealLeaf(target)
  }

  async openDashboard(): Promise<void> {
    await this.open(PM_DASHBOARD_VIEW_TYPE, {})
  }

  async openProject(file: TFile): Promise<void> {
    await this.openScope({ kind: 'project', path: file.path })
  }

  async openScope(scope: ScopeSpec, leaf?: WorkspaceLeaf): Promise<void> {
    await this.open(PM_PROJECT_VIEW_TYPE, { scope }, leaf)
  }

  async openProjectOverview(path: string, leaf?: WorkspaceLeaf): Promise<void> {
    await this.open(PM_PROJECT_OVERVIEW_VIEW_TYPE, { filePath: path }, leaf)
  }

  async openProjectEdit(path: string, leaf?: WorkspaceLeaf): Promise<void> {
    await this.open(PM_PROJECT_EDIT_VIEW_TYPE, { filePath: path }, leaf)
  }

  async openTask(state: TaskViewState): Promise<void> {
    await this.open(PM_TASK_VIEW_TYPE, state)
  }

  async openProjectByPath(path: string): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(path)
    if (file instanceof TFile) await this.openProject(file)
  }
}

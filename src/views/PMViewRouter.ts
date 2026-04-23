import { TFile } from 'obsidian'
import type PMPlugin from '../main'
import { PM_DASHBOARD_VIEW_TYPE } from './DashboardView'
import { PM_PROJECT_VIEW_TYPE } from './ProjectView'

export class PMViewRouter {
  constructor(private plugin: PMPlugin) {}

  async openDashboard(): Promise<void> {
    const ws = this.plugin.app.workspace
    const leaf = ws.getLeaf('tab')
    await leaf.setViewState({ type: PM_DASHBOARD_VIEW_TYPE, state: {} })
    await ws.revealLeaf(leaf)
  }

  async openProject(file: TFile): Promise<void> {
    const ws = this.plugin.app.workspace
    const leaf = ws.getLeaf('tab')
    await leaf.setViewState({ type: PM_PROJECT_VIEW_TYPE, state: { filePath: file.path } })
    await ws.revealLeaf(leaf)
  }

  async openProjectByPath(path: string): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(path)
    if (file instanceof TFile) await this.openProject(file)
  }
}

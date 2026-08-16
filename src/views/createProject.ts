import type PMPlugin from '../main'
import type { Project } from '../types'
import { promptText } from '../ui/ModalFactory'

/**
 * Names a project, writes it, and opens its settings. Interim: the create page that
 * asks for the rest up front replaces this.
 */
export async function createProject(plugin: PMPlugin): Promise<Project | null> {
  const title = await promptText(plugin.app, 'Project name', 'My awesome project')
  if (!title) return null
  const project = await plugin.store.createProject(title, plugin.settings.projectsFolder)
  await plugin.router.openProjectEdit(project.filePath)
  return project
}

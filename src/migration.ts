import { Notice, TFile } from 'obsidian'
import type PMPlugin from './main'
import { parseFrontmatter, isOldFormat } from './store/YamlParser'

/** Rewrites projects whose tasks are embedded in frontmatter as one file per task. */
export async function migrateProjects(plugin: PMPlugin): Promise<void> {
  let migrated = 0

  for (const path of plugin.index.projectPaths()) {
    const file = plugin.app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) continue
    try {
      const content = await plugin.app.vault.read(file)
      const { frontmatter } = parseFrontmatter(content)
      if (!frontmatter || frontmatter['pm-project'] !== true) continue
      if (!isOldFormat(frontmatter)) continue

      const project = await plugin.store.loadProject(file)
      if (!project || project.tasks.length === 0) continue

      new Notice(`Migrating project: ${project.title}...`)

      await plugin.store.saveProject(project)
      migrated++
    } catch (e) {
      console.error(`[PM] Migration failed for ${file.path}:`, e)
      new Notice(`Project Manager: Migration failed for "${file.basename}". Check console for details.`)
    }
  }

  if (migrated > 0) {
    new Notice(`Project Manager: Migrated ${migrated} project(s) to new format.`)
  }
}

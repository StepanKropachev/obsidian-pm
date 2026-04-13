import { Notice } from 'obsidian';
import type PMPlugin from './main';
import { parseFrontmatter, isOldFormat } from './store/YamlParser';

/**
 * Migrates old-format projects (tasks embedded in YAML frontmatter)
 * to new format (individual .md files per task).
 */
export async function migrateProjects(plugin: PMPlugin): Promise<void> {
  const folder = plugin.settings.projectsFolder;
  const files = plugin.app.vault.getMarkdownFiles().filter(f =>
    f.path.startsWith(folder + '/') && f.path.split('/').length === 2,
  );

  let migrated = 0;

  for (const file of files) {
    try {
      const content = await plugin.app.vault.read(file);
      const { frontmatter } = parseFrontmatter(content);
      if (!frontmatter || frontmatter['pm-project'] !== true) continue;
      if (!isOldFormat(frontmatter)) continue;

      // This project needs migration
      const project = await plugin.store.loadProject(file);
      if (!project || project.tasks.length === 0) continue;

      new Notice(`Migrating project: ${project.title}...`);

      // saveProject will create individual task files
      await plugin.store.saveProject(project);
      migrated++;
    } catch (e) {
      console.error(`[PM] Migration failed for ${file.path}:`, e);
      new Notice(`Project Manager: Migration failed for "${file.basename}". Check console for details.`);
    }
  }

  if (migrated > 0) {
    new Notice(`Project Manager: Migrated ${migrated} project(s) to new format.`);
  }
}

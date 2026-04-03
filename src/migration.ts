import { TFile, Notice } from 'obsidian';
import type PMPlugin from './main';
import type { PMSettings } from './types';
import { flattenTasks } from './store/TaskTreeOps';

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
      const { frontmatter } = plugin.store.parseFrontmatter(content);
      if (!frontmatter || frontmatter['pm-project'] !== true) continue;
      if (!plugin.store.isOldFormat(frontmatter)) continue;

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

/**
 * Migrates old emoji-based icons in statuses/priorities to empty strings,
 * and remaps old priority colors to muted tones.
 * Returns true if any changes were made.
 */
export function migrateSettingsIcons(settings: PMSettings): boolean {
  const oldPrioIcons = ['🔴', '🟠', '🟡', '🟢', '●'];
  const oldStatusIcons = ['○', '◑', '⊘', '◎', '●', '✕'];
  let migrated = false;

  if (settings.priorities.some(p => oldPrioIcons.includes(p.icon))) {
    for (const p of settings.priorities) {
      if (oldPrioIcons.includes(p.icon)) p.icon = '';
    }
    const colorMap: Record<string, string> = {
      '#dc2626': '#c47070',
      '#ea580c': '#b8a06b',
      '#ca8a04': '#8a94a0',
      '#16a34a': '#79b58d',
    };
    for (const p of settings.priorities) {
      if (colorMap[p.color]) p.color = colorMap[p.color];
    }
    migrated = true;
  }

  if (settings.statuses.some(s => oldStatusIcons.includes(s.icon))) {
    for (const s of settings.statuses) {
      if (oldStatusIcons.includes(s.icon)) s.icon = '';
    }
    migrated = true;
  }

  return migrated;
}

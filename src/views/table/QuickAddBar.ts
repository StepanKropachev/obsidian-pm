import type PMPlugin from '../../main';
import type { Project } from '../../types';
import { makeTask, addTaskToTree } from '../../types';

export function renderQuickAddBar(
  container: HTMLElement,
  project: Project,
  plugin: PMPlugin,
  onRefresh: () => Promise<void>,
): void {
  const bar = container.createDiv('pm-quick-add');
  const input = bar.createEl('input', {
    type: 'text',
    placeholder: 'Quick add task… (press Enter)',
    cls: 'pm-quick-add-input',
  });
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const title = input.value.trim();
      if (!title) return;
      const task = makeTask({ title });
      addTaskToTree(project.tasks, task, null);
      await plugin.store.saveProject(project);
      input.value = '';
      await onRefresh();
    } else if (e.key === 'Escape') {
      input.value = '';
      input.blur();
    }
  });
}

export function focusQuickAdd(container: HTMLElement): void {
  const input = container.querySelector('.pm-quick-add-input') as HTMLInputElement | null;
  if (input) { input.focus(); input.select(); }
}

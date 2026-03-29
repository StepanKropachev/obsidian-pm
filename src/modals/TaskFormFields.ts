import { Menu } from 'obsidian';
import type PMPlugin from '../main';
import {
  Project, Task, TaskStatus, TaskPriority, TaskType, Recurrence,
  CustomFieldDef,
} from '../types';
import { flattenTasks } from '../store/TaskTreeOps';
import { renderPropRow, renderProgressSlider } from '../ui/FormField';
import { COLOR_MUTED } from '../constants';

export interface TaskFormFieldsContext {
  task: Task;
  project: Project;
  plugin: PMPlugin;
  parentId: string | null;
  setParentId: (id: string | null) => void;
  rerender: () => void;
}

/**
 * Renders all property rows (status, priority, type, dates, assignees, tags, deps, custom fields)
 * into the given container.
 */
export function renderTaskFormFields(container: HTMLElement, ctx: TaskFormFieldsContext): void {
  const { task, project, plugin, rerender } = ctx;

  // Status
  renderPropRow(container, 'Status', () => {
    const statusConfig = plugin.settings.statuses.find(s => s.id === task.status);
    const val = createEl('button', { cls: 'pm-prop-value pm-prop-value--badge' });
    val.style.setProperty('--badge-color', statusConfig?.color ?? COLOR_MUTED);
    val.setText(`${statusConfig?.icon ?? ''} ${statusConfig?.label ?? task.status}`);
    val.addEventListener('click', e => {
      const menu = new Menu();
      for (const s of plugin.settings.statuses) {
        menu.addItem(item => item
          .setTitle(`${s.icon} ${s.label}`)
          .setChecked(s.id === task.status)
          .onClick(() => { task.status = s.id as TaskStatus; rerender(); }));
      }
      menu.showAtMouseEvent(e as MouseEvent);
    });
    return val;
  });

  // Priority
  renderPropRow(container, 'Priority', () => {
    const prioConfig = plugin.settings.priorities.find(p => p.id === task.priority);
    const val = createEl('button', { cls: 'pm-prop-value pm-prop-value--badge' });
    val.style.setProperty('--badge-color', prioConfig?.color ?? COLOR_MUTED);
    val.setText(`${prioConfig?.icon ?? ''} ${prioConfig?.label ?? task.priority}`);
    val.addEventListener('click', e => {
      const menu = new Menu();
      for (const p of plugin.settings.priorities) {
        menu.addItem(item => item
          .setTitle(`${p.icon} ${p.label}`)
          .setChecked(p.id === task.priority)
          .onClick(() => { task.priority = p.id as TaskPriority; rerender(); }));
      }
      menu.showAtMouseEvent(e as MouseEvent);
    });
    return val;
  });

  // Type
  renderPropRow(container, 'Type', () => {
    const wrap = createDiv('pm-prop-value pm-prop-type-selector');
    const types: { id: TaskType; label: string; cls: string }[] = [
      { id: 'task', label: 'Task', cls: '' },
      { id: 'subtask', label: 'Subtask', cls: 'pm-prop-type-btn--subtask' },
      { id: 'milestone', label: 'Milestone', cls: 'pm-prop-type-btn--milestone' },
    ];
    for (const t of types) {
      const btn = wrap.createEl('button', {
        cls: `pm-prop-type-btn ${t.cls} ${task.type === t.id ? 'pm-prop-type-btn--active' : ''}`,
      });
      btn.setText(t.label);
      btn.addEventListener('click', () => {
        task.type = t.id;
        if (t.id === 'milestone') { task.start = ''; task.progress = 0; }
        rerender();
      });
    }
    return wrap;
  });

  // Parent task selector (subtask type only)
  if (task.type === 'subtask') {
    renderPropRow(container, 'Parent Task', () => {
      const wrap = createDiv('pm-prop-value');
      const allTasks = flattenTasks(project.tasks).map(f => f.task).filter(t => t.id !== task.id);
      const sel = wrap.createEl('select', { cls: 'pm-prop-select' });
      sel.createEl('option', { value: '', text: ctx.parentId ? '' : '— Select parent —' });
      for (const t of allTasks) {
        const opt = sel.createEl('option', { value: t.id, text: t.title });
        if (t.id === ctx.parentId) opt.selected = true;
      }
      sel.addEventListener('change', () => { ctx.setParentId(sel.value || null); });
      return wrap;
    });
  }

  // Progress (hidden for milestones)
  if (task.type !== 'milestone') {
    renderPropRow(container, 'Progress', () => {
      const wrap = createDiv();
      return renderProgressSlider(wrap, task.progress, v => { task.progress = v; });
    });
  }

  // Start date (hidden for milestones)
  if (task.type !== 'milestone') {
    renderPropRow(container, 'Start', () => {
      const input = createEl('input', { type: 'date', cls: 'pm-prop-value pm-prop-date' });
      input.value = task.start;
      input.addEventListener('change', () => { task.start = input.value; });
      return input;
    });
  }

  // Due date
  renderPropRow(container, task.type === 'milestone' ? 'Date' : 'Due', () => {
    const input = createEl('input', { type: 'date', cls: 'pm-prop-value pm-prop-date' });
    input.value = task.due;
    input.addEventListener('change', () => { task.due = input.value; });
    return input;
  });

  // Recurrence
  renderPropRow(container, 'Repeat', () => {
    const wrap = createDiv('pm-prop-value pm-prop-recurrence');
    const renderRecurrence = () => {
      wrap.empty();
      if (!task.recurrence) {
        const addBtn = wrap.createEl('button', { text: '+ Set recurrence', cls: 'pm-prop-add-btn' });
        addBtn.addEventListener('click', () => {
          task.recurrence = { interval: 'weekly', every: 1 };
          renderRecurrence();
        });
      } else {
        const rec = task.recurrence;
        const everyInput = wrap.createEl('input', { type: 'number', cls: 'pm-prop-text pm-recur-every' });
        everyInput.value = String(rec.every);
        everyInput.min = '1'; everyInput.max = '365';
        everyInput.addEventListener('change', () => { rec.every = parseInt(everyInput.value) || 1; });

        const sel = wrap.createEl('select', { cls: 'pm-prop-select pm-recur-interval' });
        for (const opt of ['daily', 'weekly', 'monthly', 'yearly'] as const) {
          const o = sel.createEl('option', { value: opt, text: opt });
          if (opt === rec.interval) o.selected = true;
        }
        sel.addEventListener('change', () => { rec.interval = sel.value as Recurrence['interval']; });

        const endWrap = wrap.createDiv('pm-recur-end');
        endWrap.createEl('span', { text: 'until', cls: 'pm-recur-label' });
        const endInput = endWrap.createEl('input', { type: 'date', cls: 'pm-prop-date pm-recur-end-input' });
        endInput.value = rec.endDate ?? '';
        endInput.addEventListener('change', () => { rec.endDate = endInput.value || undefined; });

        const rmBtn = wrap.createEl('button', { text: '\u2715', cls: 'pm-prop-add-btn pm-recur-rm' });
        rmBtn.addEventListener('click', () => { task.recurrence = undefined; renderRecurrence(); });
      }
    };
    renderRecurrence();
    return wrap;
  });

  // Assignees
  renderPropRow(container, 'Assignees', () => {
    const wrap = createDiv('pm-prop-value pm-prop-assignees');
    const renderAvatars = () => {
      wrap.empty();
      for (const a of task.assignees) {
        const chip = wrap.createEl('span', { cls: 'pm-assignee-chip' });
        chip.setText(a);
        const rm = chip.createEl('button', { text: '\u2715', cls: 'pm-assignee-chip-rm' });
        rm.addEventListener('click', () => {
          task.assignees = task.assignees.filter(x => x !== a);
          renderAvatars();
        });
      }
      const all = [...new Set([...project.teamMembers, ...plugin.settings.globalTeamMembers])];
      const remaining = all.filter(m => !task.assignees.includes(m));
      const addBtn = wrap.createEl('button', { text: '+ Add', cls: 'pm-prop-add-btn' });
      addBtn.addEventListener('click', e => {
        if (remaining.length) {
          const menu = new Menu();
          for (const m of remaining) {
            menu.addItem(item => item.setTitle(m).onClick(() => {
              task.assignees.push(m);
              renderAvatars();
            }));
          }
          menu.addSeparator();
          menu.addItem(item => item.setTitle('Type a name\u2026').onClick(() => showNameInput()));
          menu.showAtMouseEvent(e as MouseEvent);
        } else {
          showNameInput();
        }
      });
      const showNameInput = () => {
        addBtn.style.display = 'none';
        const input = wrap.createEl('input', { type: 'text', cls: 'pm-tag-input', placeholder: 'Name\u2026' });
        input.focus();
        const commit = () => {
          const name = input.value.trim();
          if (name && !task.assignees.includes(name)) {
            task.assignees.push(name);
          }
          renderAvatars();
        };
        input.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') renderAvatars(); });
        input.addEventListener('blur', commit);
      };
    };
    renderAvatars();
    return wrap;
  });

  // Tags
  renderPropRow(container, 'Tags', () => {
    const wrap = createDiv('pm-prop-value pm-prop-tags');
    const renderTags = () => {
      wrap.empty();
      for (const tag of task.tags) {
        const chip = wrap.createEl('span', { cls: 'pm-tag pm-tag--removable' });
        chip.setText(tag);
        const rm = chip.createEl('button', { text: '\u2715', cls: 'pm-tag-rm' });
        rm.addEventListener('click', () => {
          task.tags = task.tags.filter(x => x !== tag);
          renderTags();
        });
      }
      const addInput = wrap.createEl('input', { type: 'text', cls: 'pm-tag-input', placeholder: '+ tag' });
      addInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && addInput.value.trim()) {
          task.tags.push(addInput.value.trim().toLowerCase().replace(/\s+/g, '-'));
          renderTags();
        }
      });
    };
    renderTags();
    return wrap;
  });

  // Dependencies
  renderPropRow(container, 'Depends on', () => {
    const wrap = createDiv('pm-prop-value pm-prop-deps');
    const allTasks = flattenTasks(project.tasks).map(f => f.task).filter(t => t.id !== task.id);
    const renderDeps = () => {
      wrap.empty();
      for (const depId of task.dependencies) {
        const dep = allTasks.find(t => t.id === depId);
        if (!dep) continue;
        const chip = wrap.createEl('span', { cls: 'pm-dep-chip' });
        chip.setText(dep.title);
        const rm = chip.createEl('button', { text: '\u2715', cls: 'pm-dep-chip-rm' });
        rm.addEventListener('click', () => {
          task.dependencies = task.dependencies.filter(x => x !== depId);
          renderDeps();
        });
      }
      const addBtn = wrap.createEl('button', { text: '+ Add dependency', cls: 'pm-prop-add-btn' });
      addBtn.addEventListener('click', e => {
        const menu = new Menu();
        const available = allTasks.filter(t => !task.dependencies.includes(t.id));
        for (const t of available) {
          menu.addItem(item => item.setTitle(t.title).onClick(() => {
            task.dependencies.push(t.id);
            renderDeps();
          }));
        }
        if (!available.length) menu.addItem(item => item.setTitle('No tasks available').setDisabled(true));
        menu.showAtMouseEvent(e as MouseEvent);
      });
    };
    renderDeps();
    return wrap;
  });

  // Custom fields
  if (project.customFields.length > 0) {
    const cfSection = container.createDiv('pm-modal-section');
    cfSection.createEl('h4', { text: 'Custom Fields', cls: 'pm-modal-section-title' });
    const cfProps = cfSection.createDiv('pm-modal-props');
    for (const cf of project.customFields) {
      renderPropRow(cfProps, cf.name, () => renderCustomFieldInput(cf, task, project, plugin));
    }
  }
}

function renderCustomFieldInput(
  cf: CustomFieldDef,
  task: Task,
  project: Project,
  plugin: PMPlugin,
): HTMLElement {
  const currentVal = task.customFields[cf.id];
  const wrap = createDiv('pm-prop-value');
  switch (cf.type) {
    case 'text':
    case 'url': {
      const input = wrap.createEl('input', { type: cf.type === 'url' ? 'url' : 'text', cls: 'pm-prop-text' });
      input.value = String(currentVal ?? '');
      input.placeholder = cf.name;
      input.addEventListener('change', () => { task.customFields[cf.id] = input.value; });
      break;
    }
    case 'number': {
      const input = wrap.createEl('input', { type: 'number', cls: 'pm-prop-text' });
      input.value = String(currentVal ?? '');
      input.addEventListener('change', () => { task.customFields[cf.id] = parseFloat(input.value); });
      break;
    }
    case 'date': {
      const input = wrap.createEl('input', { type: 'date', cls: 'pm-prop-date' });
      input.value = String(currentVal ?? '');
      input.addEventListener('change', () => { task.customFields[cf.id] = input.value; });
      break;
    }
    case 'checkbox': {
      const input = wrap.createEl('input', { type: 'checkbox', cls: 'pm-prop-checkbox' });
      input.checked = Boolean(currentVal);
      input.addEventListener('change', () => { task.customFields[cf.id] = input.checked; });
      break;
    }
    case 'select': {
      const sel = wrap.createEl('select', { cls: 'pm-prop-select' });
      sel.createEl('option', { value: '', text: '\u2014' });
      for (const opt of cf.options ?? []) {
        const o = sel.createEl('option', { value: opt, text: opt });
        if (opt === currentVal) o.selected = true;
      }
      sel.addEventListener('change', () => { task.customFields[cf.id] = sel.value; });
      break;
    }
    case 'multiselect': {
      const vals = Array.isArray(currentVal) ? currentVal as string[] : [];
      const renderMulti = () => {
        wrap.empty();
        for (const v of vals) {
          const chip = wrap.createEl('span', { cls: 'pm-tag pm-tag--removable', text: v });
          const rm = chip.createEl('button', { text: '\u2715', cls: 'pm-tag-rm' });
          rm.addEventListener('click', () => {
            const idx = vals.indexOf(v);
            if (idx > -1) vals.splice(idx, 1);
            task.customFields[cf.id] = [...vals];
            renderMulti();
          });
        }
        const addBtn = wrap.createEl('button', { text: '+ Add', cls: 'pm-prop-add-btn' });
        addBtn.addEventListener('click', e => {
          const menu = new Menu();
          for (const opt of cf.options ?? []) {
            if (!vals.includes(opt)) {
              menu.addItem(item => item.setTitle(opt).onClick(() => {
                vals.push(opt);
                task.customFields[cf.id] = [...vals];
                renderMulti();
              }));
            }
          }
          menu.showAtMouseEvent(e as MouseEvent);
        });
      };
      renderMulti();
      break;
    }
    case 'person': {
      const input = wrap.createEl('input', { type: 'text', cls: 'pm-prop-text' });
      input.value = String(currentVal ?? '');
      input.placeholder = 'Person name';
      const all = [...new Set([...project.teamMembers, ...plugin.settings.globalTeamMembers])];
      input.setAttribute('list', `pm-persons-${cf.id}`);
      const dl = wrap.createEl('datalist', { attr: { id: `pm-persons-${cf.id}` } });
      for (const m of all) dl.createEl('option', { value: m });
      input.addEventListener('change', () => { task.customFields[cf.id] = input.value; });
      break;
    }
  }
  return wrap;
}

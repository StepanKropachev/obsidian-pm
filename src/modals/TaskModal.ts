import { App, Modal, Menu, MarkdownRenderer, Component } from 'obsidian';
import type PMPlugin from '../main';
import {
  Project, Task, TaskStatus, TaskPriority, TaskType, Recurrence, TimeLog,
  makeTask, addTaskToTree, flattenTasks, findTask, totalLoggedHours,
} from '../types';

export class TaskModal extends Modal {
  private task: Task;
  private isNew: boolean;

  constructor(
    app: App,
    private plugin: PMPlugin,
    private project: Project,
    task: Task | null,
    private parentId: string | null,
    private onSave: (task: Task) => Promise<void>,
  ) {
    super(app);
    if (task) {
      this.task = JSON.parse(JSON.stringify(task)); // deep clone
      this.isNew = false;
    } else {
      this.task = makeTask({ status: 'todo', priority: 'medium' });
      this.isNew = true;
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('pm-task-modal');
    this.modalEl.addClass('pm-modal');
    // Ensure modal content is visible (CSS variables may not cascade from .pm-root)
    this.modalEl.style.cssText = 'max-width:680px;width:90vw;max-height:88vh;background:var(--background-primary) !important;color:var(--text-normal);border:1px solid var(--background-modifier-border) !important;border-radius:12px !important;box-shadow:0 16px 48px rgba(0,0,0,0.18) !important;';
    contentEl.style.cssText = 'display:flex;flex-direction:column;gap:0;overflow-y:auto;max-height:calc(88vh - 40px);padding:0;color:var(--text-normal);';

    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    // ── Header ────────────────────────────────────────────────────────────────
    const header = contentEl.createDiv('pm-modal-header');

    const statusConfig = this.plugin.settings.statuses.find(s => s.id === this.task.status);
    const statusDot = header.createEl('span', { cls: 'pm-modal-status-dot' });
    statusDot.style.background = statusConfig?.color ?? '#94a3b8';

    const titleInput = header.createEl('input', {
      type: 'text',
      cls: 'pm-modal-title-input',
      value: this.task.title,
    });
    titleInput.placeholder = 'Task title…';
    titleInput.addEventListener('input', () => { this.task.title = titleInput.value; });
    titleInput.focus();
    titleInput.select();

    // ── Description (above properties) ──────────────────────────────────────
    const descSection = contentEl.createDiv('pm-modal-section pm-modal-desc-section');
    descSection.createEl('h4', { text: 'Description', cls: 'pm-modal-section-title' });
    const descArea = descSection.createEl('textarea', { cls: 'pm-modal-description' });
    descArea.placeholder = 'Add a description…';
    descArea.value = this.task.description;
    // Rendered markdown preview (for wiki-links etc.)
    const previewEl = descSection.createDiv('pm-modal-desc-preview');
    const renderPreview = () => {
      previewEl.empty();
      if (this.task.description.trim()) {
        const component = new Component();
        component.load();
        MarkdownRenderer.render(
          this.app,
          this.task.description,
          previewEl,
          this.project.filePath,
          component,
        );
      }
    };
    renderPreview();
    descArea.addEventListener('input', () => {
      this.task.description = descArea.value;
      renderPreview();
    });

    // ── Property strip (collapsible) ──────────────────────────────────────
    const propsContainer = contentEl.createDiv('pm-modal-props-container');
    const propsToggle = propsContainer.createEl('button', { cls: 'pm-props-toggle-btn' });
    propsToggle.setText('Properties ▶');
    const props = propsContainer.createDiv('pm-modal-props pm-modal-props--collapsed');
    propsToggle.addEventListener('click', () => {
      const collapsed = props.hasClass('pm-modal-props--collapsed');
      if (collapsed) {
        props.removeClass('pm-modal-props--collapsed');
        propsToggle.setText('Properties ▼');
      } else {
        props.addClass('pm-modal-props--collapsed');
        propsToggle.setText('Properties ▶');
      }
    });

    // Status
    this.renderPropRow(props, 'Status', () => {
      const val = contentEl.createEl('button', { cls: 'pm-prop-value pm-prop-value--badge' });
      val.style.setProperty('--badge-color', statusConfig?.color ?? '#94a3b8');
      val.setText(`${statusConfig?.icon ?? ''} ${statusConfig?.label ?? this.task.status}`);
      val.addEventListener('click', e => {
        const menu = new Menu();
        for (const s of this.plugin.settings.statuses) {
          menu.addItem(item => item
            .setTitle(`${s.icon} ${s.label}`)
            .setChecked(s.id === this.task.status)
            .onClick(() => {
              this.task.status = s.id as TaskStatus;
              this.render();
            }));
        }
        menu.showAtMouseEvent(e as MouseEvent);
      });
      return val;
    });

    // Priority
    const prioConfig = this.plugin.settings.priorities.find(p => p.id === this.task.priority);
    this.renderPropRow(props, 'Priority', () => {
      const val = contentEl.createEl('button', { cls: 'pm-prop-value pm-prop-value--badge' });
      val.style.setProperty('--badge-color', prioConfig?.color ?? '#ca8a04');
      val.setText(`${prioConfig?.icon ?? ''} ${prioConfig?.label ?? this.task.priority}`);
      val.addEventListener('click', e => {
        const menu = new Menu();
        for (const p of this.plugin.settings.priorities) {
          menu.addItem(item => item
            .setTitle(`${p.icon} ${p.label}`)
            .setChecked(p.id === this.task.priority)
            .onClick(() => {
              this.task.priority = p.id as TaskPriority;
              this.render();
            }));
        }
        menu.showAtMouseEvent(e as MouseEvent);
      });
      return val;
    });

    // Type (task / subtask / milestone)
    this.renderPropRow(props, 'Type', () => {
      const wrap = createDiv('pm-prop-value pm-prop-type-selector');
      const types: { id: TaskType; label: string; cls: string }[] = [
        { id: 'task', label: 'Task', cls: '' },
        { id: 'subtask', label: 'Subtask', cls: 'pm-prop-type-btn--subtask' },
        { id: 'milestone', label: 'Milestone', cls: 'pm-prop-type-btn--milestone' },
      ];
      for (const t of types) {
        const btn = wrap.createEl('button', {
          cls: `pm-prop-type-btn ${t.cls} ${this.task.type === t.id ? 'pm-prop-type-btn--active' : ''}`,
        });
        btn.setText(t.label);
        btn.addEventListener('click', () => {
          this.task.type = t.id;
          if (t.id === 'milestone') {
            this.task.start = '';
            this.task.progress = 0;
          }
          this.render();
        });
      }
      return wrap;
    });

    // Parent task selector (for subtask type)
    if (this.task.type === 'subtask') {
      this.renderPropRow(props, 'Parent Task', () => {
        const wrap = createDiv('pm-prop-value');
        const allTasks = flattenTasks(this.project.tasks).map(f => f.task).filter(t => t.id !== this.task.id);
        const sel = wrap.createEl('select', { cls: 'pm-prop-select' });
        sel.createEl('option', { value: '', text: this.parentId ? '' : '— Select parent —' });
        for (const t of allTasks) {
          const opt = sel.createEl('option', { value: t.id, text: t.title });
          if (t.id === this.parentId) opt.selected = true;
        }
        sel.addEventListener('change', () => {
          (this as unknown as { parentId: string | null }).parentId = sel.value || null;
        });
        return wrap;
      });
    }

    // Progress (hidden for milestones)
    if (this.task.type !== 'milestone') this.renderPropRow(props, 'Progress', () => {
      const wrap = createDiv('pm-prop-value pm-prop-progress-wrap');
      const slider = wrap.createEl('input', { type: 'range', cls: 'pm-progress-slider' });
      slider.min = '0'; slider.max = '100'; slider.step = '5';
      slider.value = String(this.task.progress);
      const label = wrap.createEl('span', { text: `${this.task.progress}%`, cls: 'pm-progress-slider-label' });
      slider.addEventListener('input', () => {
        this.task.progress = parseInt(slider.value);
        label.textContent = `${this.task.progress}%`;
      });
      return wrap;
    });

    // Start date (hidden for milestones)
    if (this.task.type !== 'milestone') {
      this.renderPropRow(props, 'Start', () => {
        const input = createEl('input', { type: 'date', cls: 'pm-prop-value pm-prop-date' });
        input.value = this.task.start;
        input.addEventListener('change', () => { this.task.start = input.value; });
        return input;
      });
    }

    // Due date (label changes for milestones)
    this.renderPropRow(props, this.task.type === 'milestone' ? 'Date' : 'Due', () => {
      const input = createEl('input', { type: 'date', cls: 'pm-prop-value pm-prop-date' });
      input.value = this.task.due;
      input.addEventListener('change', () => { this.task.due = input.value; });
      return input;
    });

    // Recurrence
    this.renderPropRow(props, 'Repeat', () => {
      const wrap = createDiv('pm-prop-value pm-prop-recurrence');
      const renderRecurrence = () => {
        wrap.empty();
        if (!this.task.recurrence) {
          const addBtn = wrap.createEl('button', { text: '+ Set recurrence', cls: 'pm-prop-add-btn' });
          addBtn.addEventListener('click', () => {
            this.task.recurrence = { interval: 'weekly', every: 1 };
            renderRecurrence();
          });
        } else {
          const rec = this.task.recurrence;
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

          const rmBtn = wrap.createEl('button', { text: '✕', cls: 'pm-prop-add-btn pm-recur-rm' });
          rmBtn.addEventListener('click', () => {
            this.task.recurrence = undefined;
            renderRecurrence();
          });
        }
      };
      renderRecurrence();
      return wrap;
    });

    // Assignees
    this.renderPropRow(props, 'Assignees', () => {
      const wrap = createDiv('pm-prop-value pm-prop-assignees');
      const renderAvatars = () => {
        wrap.empty();
        for (const a of this.task.assignees) {
          const chip = wrap.createEl('span', { cls: 'pm-assignee-chip' });
          chip.setText(a);
          const rm = chip.createEl('button', { text: '✕', cls: 'pm-assignee-chip-rm' });
          rm.addEventListener('click', () => {
            this.task.assignees = this.task.assignees.filter(x => x !== a);
            renderAvatars();
          });
        }
        // Dropdown to add
        const all = [...new Set([...this.project.teamMembers, ...this.plugin.settings.globalTeamMembers])];
        const remaining = all.filter(m => !this.task.assignees.includes(m));
        if (remaining.length || true) {
          const addBtn = wrap.createEl('button', { text: '+ Add', cls: 'pm-prop-add-btn' });
          addBtn.addEventListener('click', e => {
            const menu = new Menu();
            if (remaining.length) {
              for (const m of remaining) {
                menu.addItem(item => item.setTitle(m).onClick(() => {
                  this.task.assignees.push(m);
                  renderAvatars();
                }));
              }
              menu.addSeparator();
            }
            menu.addItem(item => item.setTitle('Type a name…').onClick(() => {
              const name = window.prompt('Assignee name:');
              if (name?.trim()) {
                this.task.assignees.push(name.trim());
                renderAvatars();
              }
            }));
            menu.showAtMouseEvent(e as MouseEvent);
          });
        }
      };
      renderAvatars();
      return wrap;
    });

    // Tags
    this.renderPropRow(props, 'Tags', () => {
      const wrap = createDiv('pm-prop-value pm-prop-tags');
      const renderTags = () => {
        wrap.empty();
        for (const tag of this.task.tags) {
          const chip = wrap.createEl('span', { cls: 'pm-tag pm-tag--removable' });
          chip.setText(tag);
          const rm = chip.createEl('button', { text: '✕', cls: 'pm-tag-rm' });
          rm.addEventListener('click', () => {
            this.task.tags = this.task.tags.filter(x => x !== tag);
            renderTags();
          });
        }
        const addInput = wrap.createEl('input', {
          type: 'text',
          cls: 'pm-tag-input',
          placeholder: '+ tag',
        });
        addInput.addEventListener('keydown', e => {
          if (e.key === 'Enter' && addInput.value.trim()) {
            this.task.tags.push(addInput.value.trim().toLowerCase().replace(/\s+/g, '-'));
            renderTags();
          }
        });
      };
      renderTags();
      return wrap;
    });

    // Dependencies
    this.renderPropRow(props, 'Depends on', () => {
      const wrap = createDiv('pm-prop-value pm-prop-deps');
      const allTasks = flattenTasks(this.project.tasks).map(f => f.task).filter(t => t.id !== this.task.id);
      const renderDeps = () => {
        wrap.empty();
        for (const depId of this.task.dependencies) {
          const dep = allTasks.find(t => t.id === depId);
          if (!dep) continue;
          const chip = wrap.createEl('span', { cls: 'pm-dep-chip' });
          chip.setText(dep.title);
          const rm = chip.createEl('button', { text: '✕', cls: 'pm-dep-chip-rm' });
          rm.addEventListener('click', () => {
            this.task.dependencies = this.task.dependencies.filter(x => x !== depId);
            renderDeps();
          });
        }
        const addBtn = wrap.createEl('button', { text: '+ Add dependency', cls: 'pm-prop-add-btn' });
        addBtn.addEventListener('click', e => {
          const menu = new Menu();
          const available = allTasks.filter(t => !this.task.dependencies.includes(t.id));
          for (const t of available) {
            menu.addItem(item => item.setTitle(t.title).onClick(() => {
              this.task.dependencies.push(t.id);
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

    // ── Custom fields ─────────────────────────────────────────────────────────
    if (this.project.customFields.length > 0) {
      const cfSection = contentEl.createDiv('pm-modal-section');
      cfSection.createEl('h4', { text: 'Custom Fields', cls: 'pm-modal-section-title' });
      const cfProps = cfSection.createDiv('pm-modal-props');
      for (const cf of this.project.customFields) {
        this.renderPropRow(cfProps, cf.name, () => {
          return this.renderCustomFieldInput(cf, this.task.customFields[cf.id]);
        });
      }
    }

    // ── Time Tracking ──────────────────────────────────────────────────────────
    if (this.task.type !== 'milestone') {
      const timeSection = contentEl.createDiv('pm-modal-section');
      const timeHeader = timeSection.createDiv('pm-modal-section-header');
      const logged = totalLoggedHours(this.task);
      const est = this.task.timeEstimate ?? 0;
      const timeLabel = est > 0 ? `Time Tracking (${logged}h / ${est}h)` : `Time Tracking (${logged}h logged)`;
      timeHeader.createEl('h4', { text: timeLabel, cls: 'pm-modal-section-title' });

      // Estimate
      const estRow = timeSection.createDiv('pm-time-est-row');
      estRow.createEl('span', { text: 'Estimate:', cls: 'pm-time-label' });
      const estInput = estRow.createEl('input', { type: 'number', cls: 'pm-prop-text pm-time-est-input' });
      estInput.value = est > 0 ? String(est) : '';
      estInput.placeholder = 'hours';
      estInput.min = '0'; estInput.step = '0.5';
      estInput.addEventListener('change', () => {
        const v = parseFloat(estInput.value);
        this.task.timeEstimate = isNaN(v) || v <= 0 ? undefined : v;
      });

      // Progress bar
      if (est > 0) {
        const pct = Math.min(100, Math.round((logged / est) * 100));
        const timeBar = timeSection.createDiv('pm-time-bar');
        const timeFill = timeBar.createDiv('pm-time-bar-fill');
        timeFill.style.width = `${pct}%`;
        timeFill.style.background = pct > 100 ? 'var(--pm-danger)' : 'var(--pm-accent)';
      }

      // Log entries
      const logList = timeSection.createDiv('pm-time-log-list');
      const renderLogs = () => {
        logList.empty();
        if (!this.task.timeLogs) this.task.timeLogs = [];
        for (let i = 0; i < this.task.timeLogs.length; i++) {
          const log = this.task.timeLogs[i];
          const row = logList.createDiv('pm-time-log-row');

          const dateInput = row.createEl('input', { type: 'date', cls: 'pm-prop-date pm-time-log-date' });
          dateInput.value = log.date;
          dateInput.addEventListener('change', () => { log.date = dateInput.value; });

          const hoursInput = row.createEl('input', { type: 'number', cls: 'pm-prop-text pm-time-log-hours' });
          hoursInput.value = String(log.hours);
          hoursInput.min = '0'; hoursInput.step = '0.25'; hoursInput.placeholder = 'h';
          hoursInput.addEventListener('change', () => { log.hours = parseFloat(hoursInput.value) || 0; });

          const noteInput = row.createEl('input', { type: 'text', cls: 'pm-prop-text pm-time-log-note' });
          noteInput.value = log.note;
          noteInput.placeholder = 'Note…';
          noteInput.addEventListener('change', () => { log.note = noteInput.value; });

          const rmBtn = row.createEl('button', { text: '✕', cls: 'pm-subtask-rm' });
          rmBtn.style.opacity = '1';
          rmBtn.addEventListener('click', () => {
            this.task.timeLogs!.splice(i, 1);
            renderLogs();
          });
        }
      };
      renderLogs();

      const addLogBtn = timeSection.createEl('button', { text: '+ Log time', cls: 'pm-prop-add-btn' });
      addLogBtn.addEventListener('click', () => {
        if (!this.task.timeLogs) this.task.timeLogs = [];
        this.task.timeLogs.push({
          date: new Date().toISOString().slice(0, 10),
          hours: 0,
          note: '',
        });
        renderLogs();
      });
    }

    // ── Subtasks ──────────────────────────────────────────────────────────────
    const subSection = contentEl.createDiv('pm-modal-section');
    const subHeader = subSection.createDiv('pm-modal-section-header');
    subHeader.createEl('h4', { text: `Subtasks (${this.task.subtasks.length})`, cls: 'pm-modal-section-title' });
    const addSubBtn = subHeader.createEl('button', { text: '+ Add', cls: 'pm-btn pm-btn-ghost pm-btn-sm' });

    const subList = subSection.createDiv('pm-modal-subtask-list');
    const renderSubtasks = () => {
      subList.empty();
      for (const sub of this.task.subtasks) {
        const row = subList.createDiv('pm-modal-subtask-row');
        const subStatus = this.plugin.settings.statuses.find(s => s.id === sub.status);

        const check = row.createEl('input', { type: 'checkbox', cls: 'pm-subtask-checkbox' });
        check.checked = sub.status === 'done';
        check.addEventListener('change', () => {
          sub.status = check.checked ? 'done' : 'todo';
          sub.progress = check.checked ? 100 : 0;
          renderSubtasks();
        });

        const dot = row.createEl('span', { cls: 'pm-subtask-dot' });
        dot.style.background = subStatus?.color ?? '#94a3b8';

        const titleEl = row.createEl('span', { text: sub.title, cls: 'pm-subtask-title' });
        titleEl.contentEditable = 'true';
        titleEl.addEventListener('blur', () => { sub.title = titleEl.textContent?.trim() ?? sub.title; });

        const rm = row.createEl('button', { text: '✕', cls: 'pm-subtask-rm' });
        rm.addEventListener('click', () => {
          this.task.subtasks = this.task.subtasks.filter(s => s.id !== sub.id);
          renderSubtasks();
        });
      }
    };
    renderSubtasks();

    addSubBtn.addEventListener('click', () => {
      const newSub = makeTask({ title: 'New subtask' });
      this.task.subtasks.push(newSub);
      renderSubtasks();
      // Focus the new subtask title
      setTimeout(() => {
        const rows = subList.querySelectorAll('.pm-subtask-title');
        const last = rows[rows.length - 1] as HTMLElement;
        if (last) { last.focus(); document.execCommand('selectAll'); }
      }, 50);
    });

    // ── Footer ────────────────────────────────────────────────────────────────
    const footer = contentEl.createDiv('pm-modal-footer');

    if (!this.isNew) {
      const deleteBtn = footer.createEl('button', { text: 'Delete', cls: 'pm-btn pm-btn-danger' });
      deleteBtn.addEventListener('click', async () => {
        if (confirm(`Delete "${this.task.title}"?`)) {
          await this.plugin.store.deleteTask(this.project, this.task.id);
          await this.onSave(this.task);
          this.close();
        }
      });
    }

    const spacer = footer.createDiv('pm-footer-spacer');

    const cancelBtn = footer.createEl('button', { text: 'Cancel', cls: 'pm-btn pm-btn-ghost' });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = footer.createEl('button', {
      text: this.isNew ? '+ Create Task' : 'Save Changes',
      cls: 'pm-btn pm-btn-primary',
    });
    const doSave = async () => {
      if (!this.task.title.trim()) {
        titleInput.focus();
        titleInput.classList.add('pm-input-error');
        return;
      }
      if (this.isNew) {
        addTaskToTree(this.project.tasks, this.task, this.parentId);
      } else {
        // Update in tree
        const { updateTaskInTree } = await import('../types');
        updateTaskInTree(this.project.tasks, this.task.id, this.task);
      }
      await this.plugin.store.saveProject(this.project);
      await this.onSave(this.task);
      this.close();
    };

    saveBtn.addEventListener('click', doSave);

    // Save on Enter (except when typing in a textarea)
    this.modalEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        doSave();
      }
    });
  }

  private renderPropRow(container: HTMLElement, label: string, valueBuilder: () => HTMLElement): void {
    const row = container.createDiv('pm-prop-row');
    row.createEl('span', { text: label, cls: 'pm-prop-label' });
    const valueEl = valueBuilder();
    row.appendChild(valueEl);
  }

  private renderCustomFieldInput(cf: import('../types').CustomFieldDef, currentVal: unknown): HTMLElement {
    const wrap = createDiv('pm-prop-value');
    switch (cf.type) {
      case 'text':
      case 'url': {
        const input = wrap.createEl('input', { type: cf.type === 'url' ? 'url' : 'text', cls: 'pm-prop-text' });
        input.value = String(currentVal ?? '');
        input.placeholder = cf.name;
        input.addEventListener('change', () => { this.task.customFields[cf.id] = input.value; });
        break;
      }
      case 'number': {
        const input = wrap.createEl('input', { type: 'number', cls: 'pm-prop-text' });
        input.value = String(currentVal ?? '');
        input.addEventListener('change', () => { this.task.customFields[cf.id] = parseFloat(input.value); });
        break;
      }
      case 'date': {
        const input = wrap.createEl('input', { type: 'date', cls: 'pm-prop-date' });
        input.value = String(currentVal ?? '');
        input.addEventListener('change', () => { this.task.customFields[cf.id] = input.value; });
        break;
      }
      case 'checkbox': {
        const input = wrap.createEl('input', { type: 'checkbox', cls: 'pm-prop-checkbox' });
        input.checked = Boolean(currentVal);
        input.addEventListener('change', () => { this.task.customFields[cf.id] = input.checked; });
        break;
      }
      case 'select': {
        const sel = wrap.createEl('select', { cls: 'pm-prop-select' });
        sel.createEl('option', { value: '', text: '—' });
        for (const opt of cf.options ?? []) {
          const o = sel.createEl('option', { value: opt, text: opt });
          if (opt === currentVal) o.selected = true;
        }
        sel.addEventListener('change', () => { this.task.customFields[cf.id] = sel.value; });
        break;
      }
      case 'multiselect': {
        const vals = Array.isArray(currentVal) ? currentVal as string[] : [];
        const renderMulti = () => {
          wrap.empty();
          for (const v of vals) {
            const chip = wrap.createEl('span', { cls: 'pm-tag pm-tag--removable', text: v });
            const rm = chip.createEl('button', { text: '✕', cls: 'pm-tag-rm' });
            rm.addEventListener('click', () => {
              const idx = vals.indexOf(v);
              if (idx > -1) vals.splice(idx, 1);
              this.task.customFields[cf.id] = [...vals];
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
                  this.task.customFields[cf.id] = [...vals];
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
        const all = [...new Set([...this.project.teamMembers, ...this.plugin.settings.globalTeamMembers])];
        input.setAttribute('list', `pm-persons-${cf.id}`);
        const dl = wrap.createEl('datalist', { attr: { id: `pm-persons-${cf.id}` } });
        for (const m of all) dl.createEl('option', { value: m });
        input.addEventListener('change', () => { this.task.customFields[cf.id] = input.value; });
        break;
      }
    }
    return wrap;
  }
}

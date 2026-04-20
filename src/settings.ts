import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type PMPlugin from './main';
import { PMSettings, DEFAULT_SETTINGS, makeId, makePortfolioConfig, makeClientConfig } from './types';
import type { PortfolioConfig, ClientConfig } from './types';
import { flattenTasks } from './store/TaskTreeOps';

export type { PMSettings };
export { DEFAULT_SETTINGS };

export class PMSettingTab extends PluginSettingTab {
  plugin: PMPlugin;

  constructor(app: App, plugin: PMPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('pm-settings');

    ;

    // ── General ──────────────────────────────────────────────────────────────
    ;

    new Setting(containerEl)
      .setName('Projects folder')
      .setDesc('Vault folder where project files are stored.')
      .addText(text => text
        .setPlaceholder('Projects')
        .setValue(this.plugin.settings.projectsFolder)
        .onChange(async v => {
          this.plugin.settings.projectsFolder = v.trim() || 'Projects';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Default view')
      .setDesc('Which view opens when you open a project.')
      .addDropdown(dd => dd
        .addOption('table', 'Table')
        .addOption('gantt', 'Gantt')
        .addOption('kanban', 'Board')
        .setValue(this.plugin.settings.defaultView)
        .onChange(async v => {
          this.plugin.settings.defaultView = v as PMSettings['defaultView'];
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Default gantt granularity')
      .addDropdown(dd => dd
        .addOption('day', 'Day')
        .addOption('week', 'Week')
        .addOption('month', 'Month')
        .addOption('quarter', 'Quarter')
        .setValue(this.plugin.settings.ganttGranularity)
        .onChange(async v => {
          this.plugin.settings.ganttGranularity = v as PMSettings['ganttGranularity'];
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Gantt week label')
      .setDesc('What to display in weekly gantt header cells.')
      .addDropdown(dd => dd
        .addOption('weekNumber', 'Week number (w15)')
        .addOption('dateRange', 'Date range (apr 7\u201313)')
        .addOption('both', 'Both (w15: apr 7\u201313)')
        .setValue(this.plugin.settings.ganttWeekLabel)
        .onChange(async v => {
          this.plugin.settings.ganttWeekLabel = v as PMSettings['ganttWeekLabel'];
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Show subtasks on board')
      .setDesc('Display subtasks as individual cards on the kanban board.')
      .addToggle(t => t
        .setValue(this.plugin.settings.kanbanShowSubtasks)
        .onChange(async v => {
          this.plugin.settings.kanbanShowSubtasks = v;
          await this.plugin.saveSettings();
        }));

    // ── Notifications ─────────────────────────────────────────────────────────
    new Setting(containerEl).setName('Due date notifications').setHeading();

    new Setting(containerEl)
      .setName('Enable notifications')
      .setDesc('Show a banner when tasks are approaching their due date.')
      .addToggle(t => t
        .setValue(this.plugin.settings.notificationsEnabled)
        .onChange(async v => {
          this.plugin.settings.notificationsEnabled = v;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Lead time (days)')
      .setDesc('How many days before the due date to show the notification.')
      .addSlider(sl => sl
        .setLimits(1, 14, 1)
        .setValue(this.plugin.settings.notificationLeadDays)
        .setDynamicTooltip()
        .onChange(async v => {
          this.plugin.settings.notificationLeadDays = v;
          await this.plugin.saveSettings();
        }));

    // ── Scheduling ───────────────────────────────────────────────────────────
    new Setting(containerEl).setName('Scheduling').setHeading();

    new Setting(containerEl)
      .setName('Auto-schedule')
      .setDesc('Automatically adjust dependent task dates when a task changes.')
      .addToggle(t => t
        .setValue(this.plugin.settings.autoSchedule)
        .onChange(async v => {
          this.plugin.settings.autoSchedule = v;
          await this.plugin.saveSettings();
        }));

    // ── Team Members ──────────────────────────────────────────────────────────
    new Setting(containerEl).setName('Team members').setHeading();

    containerEl.createEl('p', {
      cls: 'pm-settings-desc',
      text: 'Global list of people available as assignees across all projects.',
    });
    // margin handled by .pm-settings-desc CSS class

    const membersContainer = containerEl.createDiv('pm-settings-members');
    this.renderMembersList(membersContainer);

    new Setting(containerEl)
      .addButton(btn => btn
        .setButtonText('+ add member')
        .setCta()
        .onClick(() => {
          this.plugin.settings.globalTeamMembers.push('');
          void this.plugin.saveSettings();
          this.renderMembersList(membersContainer);
        }));

    // ── Projects ──────────────────────────────────────────────────────────────
    new Setting(containerEl).setName('Projects').setHeading();

    new Setting(containerEl)
      .setName('Default currency')
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc('Currency code for project budgets (e.g. EUR, USD, GBP).')
      .addText(text => text
        .setPlaceholder('EUR')
        .setValue(this.plugin.settings.defaultCurrency ?? 'EUR')
        .onChange(async v => {
          this.plugin.settings.defaultCurrency = v.trim().toUpperCase() || 'EUR';
          await this.plugin.saveSettings();
        }));

    // ── Portfolios ────────────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName('Portfolios')
      .setHeading();
    containerEl.createEl('p', {
      cls: 'pm-settings-desc',
      text: 'Portfolios organise projects in the card view. Each portfolio can have a color, icon, description, and lead.',
    });

    const groupsContainer = containerEl.createDiv('pm-settings-gcm');
    this.renderPortfoliosSection(groupsContainer);

    new Setting(containerEl)
      .addButton(btn => btn
        .setButtonText('+ add portfolio')
        .setCta()
        .onClick(() => {
          this.plugin.settings.portfolios.push(makePortfolioConfig('New Portfolio'));
          void this.plugin.saveSettings();
          this.renderPortfoliosSection(groupsContainer);
        }));

    // ── Clients ───────────────────────────────────────────────────────────────
    new Setting(containerEl)
      .setName('Clients')
      .setHeading();
    containerEl.createEl('p', {
      cls: 'pm-settings-desc',
      text: 'Clients track who projects are done for. Each client can have contact details and notes.',
    });

    const clientsContainer = containerEl.createDiv('pm-settings-gcm');
    this.renderClientsSection(clientsContainer);

    new Setting(containerEl)
      .addButton(btn => btn
        .setButtonText('+ add client')
        .setCta()
        .onClick(() => {
          this.plugin.settings.clients.push(makeClientConfig('New Client'));
          void this.plugin.saveSettings();
          this.renderClientsSection(clientsContainer);
        }));

    // ── Statuses ──────────────────────────────────────────────────────────────
    new Setting(containerEl).setName('Statuses').setHeading();
    containerEl.createEl('p', {
      cls: 'pm-settings-desc',
      text: 'Customize status labels, colors, and icons. Drag to reorder.',
    });

    const statusContainer = containerEl.createDiv('pm-settings-statuses');
    this.renderStatusList(statusContainer);

    new Setting(containerEl)
      .addButton(btn => btn
        .setButtonText('+ add status')
        .setCta()
        .onClick(() => {
          const id = 'status-' + makeId().slice(0, 6);
          this.plugin.settings.statuses.push({
            id,
            label: 'New status',
            color: '#8a94a0',
            icon: '',
            complete: false,
          });
          void this.plugin.saveSettings();
          this.renderStatusList(statusContainer);
        }));
  }

  private renderPortfoliosSection(container: HTMLElement): void {
    container.empty();
    const portfolios = this.plugin.settings.portfolios;
    if (portfolios.length === 0) {
      container.createEl('p', { text: 'No portfolios yet.', cls: 'pm-settings-gcm-empty' });
      return;
    }
    for (const portfolio of portfolios) {
      this.renderPortfolioRow(container, portfolio);
    }
  }

  private renderPortfolioRow(container: HTMLElement, group: PortfolioConfig): void {
    const row = container.createDiv('pm-settings-gcm-row');

    // Color swatch + name
    const colorInput = row.createEl('input', { type: 'color', cls: 'pm-settings-gcm-color' });
    colorInput.value = group.color;
    colorInput.addEventListener('change', () => {
      group.color = colorInput.value;
      this.plugin.settings.groupColors[group.name] = group.color; // keep legacy in sync
      void this.plugin.saveSettings();
    });

    const iconInput = row.createEl('input', {
      type: 'text', cls: 'pm-settings-gcm-icon', value: group.icon,
      attr: { placeholder: '📁', maxlength: '4' },
    });
    iconInput.addEventListener('input', () => { group.icon = iconInput.value.trim() || '📁'; void this.plugin.saveSettings(); });

    const nameInput = row.createEl('input', { type: 'text', value: group.name, cls: 'pm-settings-gcm-name' });
    nameInput.placeholder = 'Portfolio name';
    nameInput.addEventListener('change', () => {
      const newName = nameInput.value.trim();
      if (!newName) return;
      // Sync groupColors key
      if (group.name !== newName) {
        delete this.plugin.settings.groupColors[group.name];
        this.plugin.settings.groupColors[newName] = group.color;
      }
      group.name = newName;
      void this.plugin.saveSettings();
    });

    const descInput = row.createEl('input', { type: 'text', value: group.description, cls: 'pm-settings-gcm-desc' });
    descInput.placeholder = 'Description (optional)';
    descInput.addEventListener('input', () => { group.description = descInput.value; void this.plugin.saveSettings(); });

    const leadInput = row.createEl('input', { type: 'text', value: group.lead, cls: 'pm-settings-gcm-lead' });
    leadInput.placeholder = 'Lead';
    const ldl = row.createEl('datalist', { attr: { id: `pm-lead-dl-${group.id}` } });
    leadInput.setAttribute('list', `pm-lead-dl-${group.id}`);
    for (const m of this.plugin.settings.globalTeamMembers) ldl.createEl('option', { attr: { value: m } });
    leadInput.addEventListener('input', () => { group.lead = leadInput.value; void this.plugin.saveSettings(); });

    const del = row.createEl('button', { text: '✕', cls: 'pm-settings-del' });
    del.addEventListener('click', () => {
      this.plugin.settings.portfolios = this.plugin.settings.portfolios.filter(g => g.id !== group.id);
      void this.plugin.saveSettings();
      this.renderPortfoliosSection(container);
    });
  }

  private renderClientsSection(container: HTMLElement): void {
    container.empty();
    const clients = this.plugin.settings.clients;
    if (clients.length === 0) {
      container.createEl('p', { text: 'No clients yet.', cls: 'pm-settings-gcm-empty' });
      return;
    }
    for (const client of clients) {
      this.renderClientRow(container, client);
    }
  }

  private renderClientRow(container: HTMLElement, client: ClientConfig): void {
    const row = container.createDiv('pm-settings-gcm-row');

    const colorInput = row.createEl('input', { type: 'color', cls: 'pm-settings-gcm-color' });
    colorInput.value = client.color;
    colorInput.addEventListener('change', () => { client.color = colorInput.value; void this.plugin.saveSettings(); });

    const iconInput = row.createEl('input', {
      type: 'text', cls: 'pm-settings-gcm-icon', value: client.icon,
      attr: { placeholder: '🏢', maxlength: '4' },
    });
    iconInput.addEventListener('input', () => { client.icon = iconInput.value.trim() || '🏢'; void this.plugin.saveSettings(); });

    const nameInput = row.createEl('input', { type: 'text', value: client.name, cls: 'pm-settings-gcm-name' });
    nameInput.placeholder = 'Client name';
    nameInput.addEventListener('change', () => { client.name = nameInput.value.trim() || client.name; void this.plugin.saveSettings(); });

    const contactInput = row.createEl('input', { type: 'text', value: client.contactName, cls: 'pm-settings-gcm-desc' });
    contactInput.placeholder = 'Contact name (optional)';
    contactInput.addEventListener('input', () => { client.contactName = contactInput.value; void this.plugin.saveSettings(); });

    const emailInput = row.createEl('input', { type: 'text', value: client.contactEmail, cls: 'pm-settings-gcm-lead' });
    emailInput.placeholder = 'Email (optional)';
    emailInput.addEventListener('input', () => { client.contactEmail = emailInput.value; void this.plugin.saveSettings(); });

    const del = row.createEl('button', { text: '✕', cls: 'pm-settings-del' });
    del.addEventListener('click', () => {
      this.plugin.settings.clients = this.plugin.settings.clients.filter(c => c.id !== client.id);
      void this.plugin.saveSettings();
      this.renderClientsSection(container);
    });
  }

  private renderMembersList(container: HTMLElement): void {
    container.empty();
    const members = this.plugin.settings.globalTeamMembers;
    members.forEach((m, i) => {
      const row = container.createDiv('pm-settings-member-row');
      const input = row.createEl('input', { type: 'text', value: m });
      input.placeholder = 'Name';
      input.addEventListener('change', () => {
        this.plugin.settings.globalTeamMembers[i] = input.value;
        void this.plugin.saveSettings();
      });
      const del = row.createEl('button', { text: '✕' });
      del.addClass('pm-settings-del');
      del.addEventListener('click', () => {
        this.plugin.settings.globalTeamMembers.splice(i, 1);
        void this.plugin.saveSettings();
        this.renderMembersList(container);
      });
    });
  }

  private async remapOrphanTasks(deletedId: string, deletedLabel: string): Promise<void> {
    const statuses = this.plugin.settings.statuses;
    if (statuses.length === 0) return;
    const defaultStatus = statuses[0];
    const folder = this.plugin.settings.projectsFolder;
    const projects = await this.plugin.store.loadAllProjects(folder);
    let remapped = 0;
    for (const project of projects) {
      const flat = flattenTasks(project.tasks);
      let modified = false;
      for (const { task } of flat) {
        if (task.status === deletedId) {
          task.status = defaultStatus.id;
          task.updatedAt = new Date().toISOString();
          remapped++;
          modified = true;
        }
      }
      if (modified) {
        await this.plugin.store.saveProject(project);
      }
    }
    if (remapped > 0) {
      new Notice(`Remapped ${remapped} task${remapped === 1 ? '' : 's'} from '${deletedLabel}' to '${defaultStatus.label}'.`);
    }
  }

  private renderStatusList(container: HTMLElement): void {
    container.empty();
    this.plugin.settings.statuses.forEach((s, i) => {
      const row = container.createDiv('pm-settings-status-row');

      // Drag handle
      row.createEl('span', { text: '⠿', cls: 'pm-settings-drag-handle' });
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plain', String(i));
        row.addClass('pm-settings-row--dragging');
      });
      row.addEventListener('dragend', () => {
        row.removeClass('pm-settings-row--dragging');
      });
      row.addEventListener('dragover', (e) => { e.preventDefault(); });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromIdx = parseInt(e.dataTransfer?.getData('text/plain') ?? '', 10);
        if (isNaN(fromIdx) || fromIdx === i) return;
        const statuses = this.plugin.settings.statuses;
        const [moved] = statuses.splice(fromIdx, 1);
        statuses.splice(i, 0, moved);
        void this.plugin.saveSettings();
        this.renderStatusList(container);
      });

      // Icon input
      const icon = row.createEl('input', { type: 'text', value: s.icon });
      icon.addClass('pm-settings-status-icon');
      icon.placeholder = '';
      icon.addEventListener('change', () => {
        this.plugin.settings.statuses[i].icon = icon.value;
        void this.plugin.saveSettings();
      });

      // Label input
      const label = row.createEl('input', { type: 'text', value: s.label });
      label.addClass('pm-settings-status-label');
      label.addEventListener('change', () => {
        this.plugin.settings.statuses[i].label = label.value;
        void this.plugin.saveSettings();
      });

      // Color picker
      const color = row.createEl('input', { type: 'color', value: s.color });
      color.addEventListener('change', () => {
        this.plugin.settings.statuses[i].color = color.value;
        void this.plugin.saveSettings();
      });

      // Complete toggle
      const completeLabel = row.createEl('label', { cls: 'pm-settings-complete-toggle' });
      const checkbox = completeLabel.createEl('input', { type: 'checkbox' });
      checkbox.checked = s.complete;
      completeLabel.createEl('span', { text: 'Done', cls: 'pm-settings-complete-text' });
      checkbox.addEventListener('change', () => {
        this.plugin.settings.statuses[i].complete = checkbox.checked;
        void this.plugin.saveSettings();
      });

      // Delete button
      const del = row.createEl('button', { text: '✕', cls: 'pm-settings-del' });
      del.addEventListener('click', () => {
        if (this.plugin.settings.statuses.length <= 1) {
          new Notice('You must have at least one status.');
          return;
        }
        const deletedStatus = this.plugin.settings.statuses[i];
        this.plugin.settings.statuses.splice(i, 1);
        void this.plugin.saveSettings();
        this.renderStatusList(container);
        void this.remapOrphanTasks(deletedStatus.id, deletedStatus.label);
      });
    });
  }
}

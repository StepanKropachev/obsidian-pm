import { App, PluginSettingTab, Setting } from 'obsidian';
import type PMPlugin from './main';
import { PMSettings, DEFAULT_SETTINGS } from './types';

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

    containerEl.createEl('h2', { text: 'Project Manager' });

    // ── General ──────────────────────────────────────────────────────────────
    containerEl.createEl('h3', { text: 'General' });

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
      .setName('Default Gantt granularity')
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

    // ── Notifications ─────────────────────────────────────────────────────────
    containerEl.createEl('h3', { text: 'Due date notifications' });

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

    // ── Team Members ──────────────────────────────────────────────────────────
    containerEl.createEl('h3', { text: 'Team members' });

    const membersDesc = containerEl.createEl('p', {
      cls: 'pm-settings-desc',
      text: 'Global list of people available as assignees across all projects.',
    });
    // margin handled by .pm-settings-desc CSS class

    const membersContainer = containerEl.createDiv('pm-settings-members');
    this.renderMembersList(membersContainer);

    new Setting(containerEl)
      .addButton(btn => btn
        .setButtonText('+ Add member')
        .setCta()
        .onClick(() => {
          this.plugin.settings.globalTeamMembers.push('');
          void this.plugin.saveSettings();
          this.renderMembersList(membersContainer);
        }));

    // ── Statuses ──────────────────────────────────────────────────────────────
    containerEl.createEl('h3', { text: 'Statuses' });
    containerEl.createEl('p', {
      cls: 'pm-settings-desc',
      text: 'Customize status labels, colors, and icons. Drag to reorder.',
    });

    const statusContainer = containerEl.createDiv('pm-settings-statuses');
    this.renderStatusList(statusContainer);
  }

  private renderMembersList(container: HTMLElement): void {
    container.empty();
    const members = this.plugin.settings.globalTeamMembers;
    members.forEach((m, i) => {
      const row = container.createDiv('pm-settings-member-row');
      const input = row.createEl('input', { type: 'text', value: m });
      input.placeholder = 'Name';
      input.addEventListener('change', async () => {
        this.plugin.settings.globalTeamMembers[i] = input.value;
        await this.plugin.saveSettings();
      });
      const del = row.createEl('button', { text: '✕' });
      del.addClass('pm-settings-del');
      del.addEventListener('click', async () => {
        this.plugin.settings.globalTeamMembers.splice(i, 1);
        await this.plugin.saveSettings();
        this.renderMembersList(container);
      });
    });
  }

  private renderStatusList(container: HTMLElement): void {
    container.empty();
    this.plugin.settings.statuses.forEach((s, i) => {
      const row = container.createDiv('pm-settings-status-row');

      const icon = row.createEl('input', { type: 'text', value: s.icon });
      icon.addEventListener('change', async () => {
        this.plugin.settings.statuses[i].icon = icon.value;
        await this.plugin.saveSettings();
      });

      const label = row.createEl('input', { type: 'text', value: s.label });
      label.addEventListener('change', async () => {
        this.plugin.settings.statuses[i].label = label.value;
        await this.plugin.saveSettings();
      });

      const color = row.createEl('input', { type: 'color', value: s.color });
      color.addEventListener('change', async () => {
        this.plugin.settings.statuses[i].color = color.value;
        await this.plugin.saveSettings();
      });
    });
  }
}

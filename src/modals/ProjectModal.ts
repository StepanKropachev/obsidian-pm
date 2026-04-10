import { App, Modal } from 'obsidian';
import type PMPlugin from '../main';
import { Project, CustomFieldDef, makeId, makeProject } from '../types';
import { stringToColor } from '../utils';
import { COLOR_DANGER } from '../constants';

const PROJECT_COLORS = [
  '#8b72be', '#7c6b9a', '#b07d9e', COLOR_DANGER,
  '#b8a06b', '#79b58d', '#6ba8a0', '#7a9ec4',
  '#767491', '#8aab6b',
];

const PROJECT_ICONS = ['📋', '🚀', '💡', '🎯', '🔬', '🏗', '📊', '🎨', '📱', '🛠', '📝', '⚡'];

/**
 * Project create/edit modal.
 *
 * Obsidian renders modals outside `.pm-root` in the DOM. We apply `.pm-modal`
 * to re-declare `--pm-*` CSS variables, then use CSS classes from styles.css.
 * Remaining inline styles are only for dynamic runtime values (computed colors,
 * avatar hashes, display toggles) that cannot be expressed in static CSS.
 */
export class ProjectModal extends Modal {
  private project: Project;
  private isNew: boolean;

  constructor(
    app: App,
    private plugin: PMPlugin,
    existingProject: Project | null,
    private onSave: (project: Project) => Promise<void>,
  ) {
    super(app);
    if (existingProject) {
      this.project = JSON.parse(JSON.stringify(existingProject));
      this.isNew = false;
    } else {
      this.project = makeProject('New Project', '');
      this.isNew = true;
    }
  }

  onOpen(): void {
    this.modalEl.addClass('pm-modal', 'pm-modal--project');
    const el = this.contentEl;
    el.empty();
    el.addClass('pm-project-modal');
    this.buildForm(el);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private buildForm(el: HTMLElement): void {
    // ── Header ────────────────────────────────────────────────────────────────
    const header = el.createDiv('pm-project-modal-header');
    header.createEl('span', { text: '✦', cls: 'pm-project-modal-header-icon' });
    header.createEl('h2', {
      text: this.isNew ? 'New Project' : 'Project Settings',
      cls: 'pm-modal-heading',
    });

    // ── Icon + Title ──────────────────────────────────────────────────────────
    const topRow = el.createDiv('pm-project-top-row');

    // Icon picker
    const iconWrap = topRow.createDiv('pm-icon-picker');
    const iconBtn = iconWrap.createEl('button', { text: this.project.icon, cls: 'pm-icon-btn' });

    const iconGrid = iconWrap.createDiv('pm-icon-grid');
    iconGrid.addClass('pm-hidden');
    for (const emoji of PROJECT_ICONS) {
      const btn = iconGrid.createEl('button', { text: emoji, cls: 'pm-icon-option' });
      btn.addEventListener('click', () => {
        this.project.icon = emoji;
        iconBtn.textContent = emoji;
        iconGrid.addClass('pm-hidden');
      });
    }
    iconBtn.addEventListener('click', () => {
      iconGrid.toggleClass('pm-hidden', !iconGrid.hasClass('pm-hidden'));
    });

    // Title
    const titleWrap = topRow.createDiv('pm-project-title-wrap');
    titleWrap.createEl('label', { text: 'Project Name', cls: 'pm-label' });
    const titleInput = titleWrap.createEl('input', {
      type: 'text', value: this.project.title, cls: 'pm-input pm-input--lg',
    });
    titleInput.placeholder = 'My Awesome Project';
    titleInput.addEventListener('input', () => { this.project.title = titleInput.value; });
    setTimeout(() => { titleInput.focus(); titleInput.select(); }, 50);

    // ── Color ─────────────────────────────────────────────────────────────────
    const colorSection = el.createDiv('pm-project-modal-section');
    colorSection.createEl('label', { text: 'Color', cls: 'pm-label' });
    const colorPalette = colorSection.createDiv('pm-color-palette');
    for (const color of PROJECT_COLORS) {
      const swatch = colorPalette.createEl('button', { cls: 'pm-color-swatch' });
      swatch.setCssStyles({ background: color });
      if (color === this.project.color) swatch.addClass('pm-color-swatch--selected');
      swatch.addEventListener('click', () => {
        this.project.color = color;
        colorPalette.querySelectorAll('.pm-color-swatch').forEach(s =>
          s.removeClass('pm-color-swatch--selected'));
        swatch.addClass('pm-color-swatch--selected');
      });
    }
    const customColor = colorPalette.createEl('input', { type: 'color', cls: 'pm-color-custom' });
    customColor.value = this.project.color;
    customColor.title = 'Custom color';
    customColor.addEventListener('change', () => {
      this.project.color = customColor.value;
      colorPalette.querySelectorAll('.pm-color-swatch').forEach(s =>
        s.removeClass('pm-color-swatch--selected'));
    });

    // ── Description ───────────────────────────────────────────────────────────
    const descSection = el.createDiv('pm-project-modal-section');
    descSection.createEl('label', { text: 'Description', cls: 'pm-label' });
    const descArea = descSection.createEl('textarea', { cls: 'pm-input pm-project-desc' });
    descArea.placeholder = 'What is this project about?';
    descArea.value = this.project.description;
    descArea.addEventListener('input', () => { this.project.description = descArea.value; });

    // ── Team members ──────────────────────────────────────────────────────────
    const memberSection = el.createDiv('pm-modal-section');
    memberSection.createEl('label', { text: 'Team Members', cls: 'pm-label' });
    const memberWrap = memberSection.createDiv('pm-member-list');
    const renderMembers = () => {
      memberWrap.empty();
      for (let i = 0; i < this.project.teamMembers.length; i++) {
        const row = memberWrap.createDiv('pm-member-row');
        const name = this.project.teamMembers[i] || '?';
        const avatar = row.createEl('span', { cls: 'pm-avatar' });
        avatar.textContent = name.slice(0, 2).toUpperCase();
        avatar.setCssStyles({ background: stringToColor(name) });
        const input = row.createEl('input', {
          type: 'text', value: this.project.teamMembers[i], cls: 'pm-input pm-member-input',
        });
        input.placeholder = 'Name';
        input.addEventListener('change', () => {
          this.project.teamMembers[i] = input.value;
          renderMembers();
        });
        const rm = row.createEl('button', { text: '✕', cls: 'pm-settings-del' });
        rm.addEventListener('click', () => {
          this.project.teamMembers.splice(i, 1);
          renderMembers();
        });
      }
      const addBtn = memberWrap.createEl('button', { text: '+ Add member', cls: 'pm-prop-add-btn' });
      addBtn.addEventListener('click', () => {
        this.project.teamMembers.push('');
        renderMembers();
        setTimeout(() => {
          const inputs = memberWrap.querySelectorAll('input');
          (inputs[inputs.length - 1] as HTMLInputElement)?.focus();
        }, 50);
      });
    };
    renderMembers();

    // ── Custom fields ─────────────────────────────────────────────────────────
    const cfSection = el.createDiv('pm-modal-section');
    const cfHeader = cfSection.createDiv('pm-modal-section-header');
    cfHeader.createEl('span', { text: 'Custom Fields', cls: 'pm-modal-subheading' });
    cfHeader.createEl('span', { text: 'extra properties for tasks', cls: 'pm-modal-hint' });

    const cfList = cfSection.createDiv('pm-cf-list');
    const renderCFs = () => {
      cfList.empty();
      for (let i = 0; i < this.project.customFields.length; i++) {
        this.renderCustomFieldEditor(cfList, this.project.customFields[i], i, renderCFs);
      }
      const addCFBtn = cfList.createEl('button', { text: '+ Add Custom Field', cls: 'pm-prop-add-btn' });
      addCFBtn.addEventListener('click', () => {
        this.project.customFields.push({ id: makeId(), name: 'New Field', type: 'text', options: [] });
        renderCFs();
      });
    };
    renderCFs();

    // ── Footer ────────────────────────────────────────────────────────────────
    const footer = el.createDiv('pm-modal-footer');
    footer.createDiv('pm-footer-spacer');

    const cancelBtn = footer.createEl('button', { text: 'Cancel', cls: 'pm-btn pm-btn-ghost' });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = footer.createEl('button', {
      text: this.isNew ? '+ Create Project' : 'Save',
      cls: 'pm-btn pm-btn-primary',
    });
    saveBtn.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      if (!title) {
        titleInput.addClass('pm-input-error');
        titleInput.focus();
        return;
      }
      this.project.title = title;

      if (this.isNew) {
        this.project.filePath = `${this.plugin.settings.projectsFolder}/${title.replace(/[\\/:*?"<>|]/g, '-')}.md`;
        await this.plugin.store.ensureFolder(this.plugin.settings.projectsFolder);
      }

      await this.plugin.store.saveProject(this.project);
      await this.onSave(this.project);
      this.close();
    });
  }

  private renderCustomFieldEditor(container: HTMLElement, cf: CustomFieldDef, index: number, rerender: () => void): void {
    const row = container.createDiv('pm-cf-row');

    const nameInput = row.createEl('input', { type: 'text', value: cf.name, cls: 'pm-input pm-cf-name' });
    nameInput.placeholder = 'Field name';
    nameInput.addEventListener('change', () => { this.project.customFields[index].name = nameInput.value; });

    const typeSelect = row.createEl('select', { cls: 'pm-input pm-select pm-cf-type' });
    const types: [CustomFieldDef['type'], string][] = [
      ['text', 'Text'], ['number', 'Number'], ['date', 'Date'],
      ['select', 'Select'], ['multiselect', 'Multi-select'],
      ['person', 'Person'], ['checkbox', 'Checkbox'], ['url', 'URL'],
    ];
    for (const [val, label] of types) {
      const opt = typeSelect.createEl('option', { value: val, text: label });
      if (val === cf.type) opt.selected = true;
    }
    typeSelect.addEventListener('change', () => {
      this.project.customFields[index].type = typeSelect.value as CustomFieldDef['type'];
      rerender();
    });

    const rmBtn = row.createEl('button', { text: '✕', cls: 'pm-settings-del' });
    rmBtn.addEventListener('click', () => {
      this.project.customFields.splice(index, 1);
      rerender();
    });

    if (cf.type === 'select' || cf.type === 'multiselect') {
      const optionsWrap = row.createDiv('pm-cf-options');
      const opts = cf.options ?? [];
      const renderOpts = () => {
        optionsWrap.empty();
        for (let j = 0; j < opts.length; j++) {
          const optRow = optionsWrap.createDiv('pm-cf-opt-row');
          const optInput = optRow.createEl('input', { type: 'text', value: opts[j], cls: 'pm-input pm-cf-opt-input' });
          optInput.placeholder = `Option ${j + 1}`;
          optInput.addEventListener('change', () => { opts[j] = optInput.value; cf.options = opts; });
          const rmOptBtn = optRow.createEl('button', { text: '✕', cls: 'pm-settings-del' });
          rmOptBtn.addEventListener('click', () => { opts.splice(j, 1); cf.options = opts; renderOpts(); });
        }
        const addOptBtn = optionsWrap.createEl('button', { text: '+ Option', cls: 'pm-prop-add-btn pm-prop-add-btn--sm' });
        addOptBtn.addEventListener('click', () => { opts.push(''); cf.options = opts; renderOpts(); });
      };
      renderOpts();
    }
  }
}

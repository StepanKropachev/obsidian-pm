import { App, Modal } from 'obsidian';
import type PMPlugin from '../main';
import { Project, CustomFieldDef, makeId, makeProject } from '../types';
import { sanitizeFileName } from '../utils';

const PROJECT_COLORS = [
  '#69519a', '#7c6b9a', '#b07d9e', '#b83b3b',
  '#b8862b', '#306a48', '#4a8c7e', '#4a7eb8',
  '#6b7280', '#6b8a3d',
];

const PROJECT_ICONS = ['📋', '🚀', '💡', '🎯', '🔬', '🏗', '📊', '🎨', '📱', '🛠', '📝', '⚡'];

// Shared style constants
const S = {
  label: `font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;display:block;`,
  input: `width:100%;padding:8px 12px;border:1px solid var(--background-modifier-border);border-radius:8px;background:var(--background-secondary);color:var(--text-normal);font-size:13px;box-sizing:border-box;outline:none;transition:border-color 0.2s,background 0.2s;`,
  inputFocus: `border-color:#69519a;`,
  btnGhost: `padding:5px 12px;border-radius:0.25rem;border:1px solid var(--background-modifier-border);background:transparent;color:var(--text-normal);cursor:pointer;font-size:12px;transition:all 0.15s;`,
  btnPrimary: `padding:8px 20px;border-radius:0.375rem;border:none;background:linear-gradient(180deg,#69519a,#5d458d);color:#fff;cursor:pointer;font-weight:600;font-size:13px;transition:all 0.15s;box-shadow:0 2px 8px rgba(105,81,154,0.2);`,
  btnAdd: `padding:4px 0;border:none;background:transparent;color:#69519a;cursor:pointer;font-size:12px;font-weight:600;transition:color 0.15s;`,
  section: `display:flex;flex-direction:column;gap:6px;`,
  divider: `height:1px;background:var(--background-modifier-border);margin:4px 0;`,
};

function addFocusStyle(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void {
  input.addEventListener('focus', () => { input.style.cssText += S.inputFocus; });
  input.addEventListener('blur', () => {
    input.style.borderColor = 'var(--background-modifier-hover)';
    input.style.background = 'var(--background-secondary)';
  });
}

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
    this.modalEl.style.cssText = `
      max-width:540px;width:90vw;max-height:88vh;
      background:var(--background-primary) !important;
      border:1px solid rgba(0,0,0,0.06) !important;
      box-shadow:0 8px 24px rgba(0,0,0,0.06) !important;
      border-radius:0.5rem !important;
      color:var(--text-normal);
    `;

    const el = this.contentEl;
    el.empty();
    el.style.cssText = 'padding:24px 28px;display:flex;flex-direction:column;gap:18px;overflow-y:auto;max-height:80vh;color:var(--text-normal);';

    this.buildForm(el);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private buildForm(el: HTMLElement): void {
    // ── Header ────────────────────────────────────────────────────────────────
    const header = el.createDiv();
    header.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:2px;';
    const headerIcon = header.createEl('span', { text: '✦' });
    headerIcon.style.cssText = 'font-size:18px;color:#69519a;';
    const h2 = header.createEl('h2', { text: this.isNew ? 'New Project' : 'Project Settings' });
    h2.style.cssText = 'margin:0;font-size:18px;font-weight:700;letter-spacing:-0.02em;';

    // ── Icon + Title ──────────────────────────────────────────────────────────
    const topRow = el.createDiv();
    topRow.style.cssText = 'display:flex;gap:14px;align-items:flex-start;position:relative;';

    // Icon picker
    const iconWrap = topRow.createDiv();
    iconWrap.style.cssText = 'position:relative;flex-shrink:0;';
    const iconBtn = iconWrap.createEl('button', { text: this.project.icon });
    iconBtn.style.cssText = `
      font-size:28px;width:52px;height:52px;display:flex;align-items:center;justify-content:center;
      background:var(--background-secondary);border:1px solid var(--background-modifier-border);
      border-radius:12px;cursor:pointer;transition:all 0.2s;line-height:1;
    `;
    iconBtn.addEventListener('mouseenter', () => { iconBtn.style.background = 'var(--background-modifier-hover)'; });
    iconBtn.addEventListener('mouseleave', () => { iconBtn.style.background = 'var(--background-secondary)'; });

    const iconGrid = iconWrap.createDiv();
    iconGrid.style.cssText = `
      display:none;position:absolute;top:56px;left:0;z-index:100;
      background:var(--background-primary);border:1px solid var(--background-modifier-border);
      border-radius:12px;padding:10px;
      grid-template-columns:repeat(6,1fr);gap:2px;
      box-shadow:0 8px 24px rgba(0,0,0,0.06);
    `;
    for (const emoji of PROJECT_ICONS) {
      const btn = iconGrid.createEl('button', { text: emoji });
      btn.style.cssText = 'font-size:18px;padding:6px;border:none;background:transparent;cursor:pointer;border-radius:6px;transition:background 0.15s;';
      btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--background-modifier-hover)'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
      btn.addEventListener('click', () => {
        this.project.icon = emoji;
        iconBtn.textContent = emoji;
        iconGrid.style.display = 'none';
      });
    }
    iconBtn.addEventListener('click', () => {
      iconGrid.style.display = iconGrid.style.display === 'none' ? 'grid' : 'none';
    });

    // Title
    const titleWrap = topRow.createDiv();
    titleWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:4px;';
    titleWrap.createEl('label', { text: 'Project Name' }).style.cssText = S.label;
    const titleInput = titleWrap.createEl('input', { type: 'text', value: this.project.title });
    titleInput.placeholder = 'My Awesome Project';
    titleInput.style.cssText = S.input + 'font-size:15px;font-weight:500;padding:10px 14px;';
    addFocusStyle(titleInput);
    titleInput.addEventListener('input', () => { this.project.title = titleInput.value; });
    setTimeout(() => { titleInput.focus(); titleInput.select(); }, 50);

    // ── Color ─────────────────────────────────────────────────────────────────
    const colorSection = el.createDiv();
    colorSection.style.cssText = S.section;
    colorSection.createEl('label', { text: 'Color' }).style.cssText = S.label;
    const colorPalette = colorSection.createDiv();
    colorPalette.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;';
    for (const color of PROJECT_COLORS) {
      const swatch = colorPalette.createEl('button');
      const isSelected = color === this.project.color;
      swatch.style.cssText = `
        width:26px;height:26px;border-radius:50%;cursor:pointer;background:${color};
        border:2.5px solid ${isSelected ? 'var(--text-normal)' : 'transparent'};
        transition:all 0.2s;transform:${isSelected ? 'scale(1.15)' : 'scale(1)'};
        box-shadow:${isSelected ? `0 0 12px ${color}60` : 'none'};
      `;
      swatch.addEventListener('mouseenter', () => { if (swatch.style.borderColor === 'transparent') swatch.style.transform = 'scale(1.1)'; });
      swatch.addEventListener('mouseleave', () => { if (swatch.style.borderColor === 'transparent') swatch.style.transform = 'scale(1)'; });
      swatch.addEventListener('click', () => {
        this.project.color = color;
        colorPalette.querySelectorAll('button').forEach(s => {
          (s as HTMLElement).style.borderColor = 'transparent';
          (s as HTMLElement).style.transform = 'scale(1)';
          (s as HTMLElement).style.boxShadow = 'none';
        });
        swatch.style.borderColor = 'var(--text-normal)';
        swatch.style.transform = 'scale(1.15)';
        swatch.style.boxShadow = `0 0 12px ${color}60`;
      });
    }
    const customColor = colorPalette.createEl('input', { type: 'color' });
    customColor.value = this.project.color;
    customColor.style.cssText = 'width:26px;height:26px;border:none;background:transparent;cursor:pointer;padding:0;border-radius:50%;';
    customColor.title = 'Custom color';
    customColor.addEventListener('change', () => {
      this.project.color = customColor.value;
      colorPalette.querySelectorAll('button').forEach(s => {
        (s as HTMLElement).style.borderColor = 'transparent';
        (s as HTMLElement).style.transform = 'scale(1)';
        (s as HTMLElement).style.boxShadow = 'none';
      });
    });

    // ── Description ───────────────────────────────────────────────────────────
    const descSection = el.createDiv();
    descSection.style.cssText = S.section;
    descSection.createEl('label', { text: 'Description' }).style.cssText = S.label;
    const descArea = descSection.createEl('textarea');
    descArea.placeholder = 'What is this project about?';
    descArea.value = this.project.description;
    descArea.style.cssText = S.input + 'min-height:72px;resize:vertical;font-family:inherit;';
    addFocusStyle(descArea);
    descArea.addEventListener('input', () => { this.project.description = descArea.value; });

    // ── Divider ───────────────────────────────────────────────────────────────
    el.createDiv().style.cssText = S.divider;

    // ── Team members ──────────────────────────────────────────────────────────
    const memberSection = el.createDiv();
    memberSection.style.cssText = S.section;
    memberSection.createEl('label', { text: 'Team Members' }).style.cssText = S.label;
    const memberWrap = memberSection.createDiv();
    memberWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
    const renderMembers = () => {
      memberWrap.empty();
      for (let i = 0; i < this.project.teamMembers.length; i++) {
        const row = memberWrap.createDiv();
        row.style.cssText = 'display:flex;gap:8px;align-items:center;';
        const avatar = row.createEl('span');
        const name = this.project.teamMembers[i] || '?';
        avatar.textContent = name.slice(0, 2).toUpperCase();
        avatar.style.cssText = `
          width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;
          font-size:10px;font-weight:700;color:#fff;flex-shrink:0;
          background:hsl(${Math.abs(name.split('').reduce((h, c) => c.charCodeAt(0) + ((h << 5) - h), 0)) % 360},55%,45%);
        `;
        const input = row.createEl('input', { type: 'text', value: this.project.teamMembers[i] });
        input.placeholder = 'Name';
        input.style.cssText = S.input + 'flex:1;';
        addFocusStyle(input);
        input.addEventListener('change', () => {
          this.project.teamMembers[i] = input.value;
          renderMembers();
        });
        const rm = row.createEl('button', { text: '✕' });
        rm.style.cssText = 'border:none;background:transparent;color:var(--text-muted,#666);cursor:pointer;font-size:14px;padding:4px 6px;border-radius:4px;transition:all 0.15s;';
        rm.addEventListener('mouseenter', () => { rm.style.color = '#b83b3b'; });
        rm.addEventListener('mouseleave', () => { rm.style.color = 'var(--text-muted,#666)'; });
        rm.addEventListener('click', () => {
          this.project.teamMembers.splice(i, 1);
          renderMembers();
        });
      }
      const addBtn = memberWrap.createEl('button', { text: '+ Add member' });
      addBtn.style.cssText = S.btnAdd;
      addBtn.addEventListener('mouseenter', () => { addBtn.style.color = '#a5b4fc'; });
      addBtn.addEventListener('mouseleave', () => { addBtn.style.color = '#69519a'; });
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
    el.createDiv().style.cssText = S.divider;

    const cfHeader = el.createDiv();
    cfHeader.style.cssText = 'display:flex;align-items:baseline;gap:8px;';
    const cfTitle = cfHeader.createEl('span', { text: 'Custom Fields' });
    cfTitle.style.cssText = 'font-size:13px;font-weight:700;';
    const cfHint = cfHeader.createEl('span', { text: 'extra properties for tasks' });
    cfHint.style.cssText = 'font-size:11px;color:var(--text-muted,#666);';

    const cfList = el.createDiv();
    cfList.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    const renderCFs = () => {
      cfList.empty();
      for (let i = 0; i < this.project.customFields.length; i++) {
        this.renderCustomFieldEditor(cfList, this.project.customFields[i], i, renderCFs);
      }
      const addCFBtn = cfList.createEl('button', { text: '+ Add Custom Field' });
      addCFBtn.style.cssText = S.btnAdd;
      addCFBtn.addEventListener('mouseenter', () => { addCFBtn.style.color = '#a5b4fc'; });
      addCFBtn.addEventListener('mouseleave', () => { addCFBtn.style.color = '#69519a'; });
      addCFBtn.addEventListener('click', () => {
        this.project.customFields.push({ id: makeId(), name: 'New Field', type: 'text', options: [] });
        renderCFs();
      });
    };
    renderCFs();

    // ── Footer ────────────────────────────────────────────────────────────────
    const footer = el.createDiv();
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;padding-top:12px;border-top:1px solid var(--background-modifier-border);margin-top:4px;';

    const cancelBtn = footer.createEl('button', { text: 'Cancel' });
    cancelBtn.style.cssText = S.btnGhost + 'padding:8px 18px;';
    cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = 'var(--background-modifier-border)'; });
    cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = 'transparent'; });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = footer.createEl('button', { text: this.isNew ? '+ Create Project' : '✓ Save' });
    saveBtn.style.cssText = S.btnPrimary;
    saveBtn.addEventListener('mouseenter', () => { saveBtn.style.boxShadow = '0 2px 12px rgba(105,81,154,0.2)'; });
    saveBtn.addEventListener('mouseleave', () => { saveBtn.style.boxShadow = '0 2px 8px rgba(105,81,154,0.15)'; });
    saveBtn.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      if (!title) {
        titleInput.style.borderColor = '#b83b3b';
        titleInput.focus();
        return;
      }
      this.project.title = title;

      if (this.isNew) {
        const safeName = title.replace(/[\\/:*?"<>|]/g, '-');
        this.project.filePath = `${this.plugin.settings.projectsFolder}/${safeName}.md`;
        await this.plugin.store.ensureFolder(this.plugin.settings.projectsFolder);
      }

      await this.plugin.store.saveProject(this.project);
      await this.onSave(this.project);
      this.close();
    });
  }

  private renderCustomFieldEditor(container: HTMLElement, cf: CustomFieldDef, index: number, rerender: () => void): void {
    const row = container.createDiv();
    row.style.cssText = `
      display:flex;gap:8px;align-items:center;padding:10px 12px;
      background:var(--background-secondary);border:1px solid var(--background-modifier-border);
      border-radius:10px;flex-wrap:wrap;transition:background 0.15s;
    `;
    row.addEventListener('mouseenter', () => { row.style.background = 'var(--background-modifier-border)'; });
    row.addEventListener('mouseleave', () => { row.style.background = 'var(--background-secondary)'; });

    const nameInput = row.createEl('input', { type: 'text', value: cf.name });
    nameInput.placeholder = 'Field name';
    nameInput.style.cssText = S.input + 'flex:1;min-width:120px;';
    addFocusStyle(nameInput);
    nameInput.addEventListener('change', () => { this.project.customFields[index].name = nameInput.value; });

    const typeSelect = row.createEl('select');
    typeSelect.style.cssText = S.input + 'width:auto;min-width:100px;cursor:pointer;';
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

    const rmBtn = row.createEl('button', { text: '✕' });
    rmBtn.style.cssText = 'border:none;background:transparent;color:var(--text-muted,#666);cursor:pointer;font-size:14px;padding:4px 6px;border-radius:4px;transition:all 0.15s;';
    rmBtn.addEventListener('mouseenter', () => { rmBtn.style.color = '#b83b3b'; });
    rmBtn.addEventListener('mouseleave', () => { rmBtn.style.color = 'var(--text-muted,#666)'; });
    rmBtn.addEventListener('click', () => {
      this.project.customFields.splice(index, 1);
      rerender();
    });

    if (cf.type === 'select' || cf.type === 'multiselect') {
      const optionsWrap = row.createDiv();
      optionsWrap.style.cssText = 'width:100%;display:flex;flex-direction:column;gap:4px;padding-top:6px;border-top:1px solid var(--background-secondary);margin-top:4px;';
      const opts = cf.options ?? [];
      const renderOpts = () => {
        optionsWrap.empty();
        for (let j = 0; j < opts.length; j++) {
          const optRow = optionsWrap.createDiv();
          optRow.style.cssText = 'display:flex;gap:4px;align-items:center;';
          const optInput = optRow.createEl('input', { type: 'text', value: opts[j] });
          optInput.placeholder = `Option ${j + 1}`;
          optInput.style.cssText = S.input + 'flex:1;padding:5px 10px;font-size:12px;';
          addFocusStyle(optInput);
          optInput.addEventListener('change', () => { opts[j] = optInput.value; cf.options = opts; });
          const rmOptBtn = optRow.createEl('button', { text: '✕' });
          rmOptBtn.style.cssText = 'border:none;background:transparent;color:var(--text-muted,#666);cursor:pointer;font-size:12px;padding:2px 4px;';
          rmOptBtn.addEventListener('click', () => { opts.splice(j, 1); cf.options = opts; renderOpts(); });
        }
        const addOptBtn = optionsWrap.createEl('button', { text: '+ Option' });
        addOptBtn.style.cssText = S.btnAdd + 'font-size:11px;';
        addOptBtn.addEventListener('click', () => { opts.push(''); cf.options = opts; renderOpts(); });
      };
      renderOpts();
    }
  }
}

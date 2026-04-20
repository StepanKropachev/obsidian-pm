import { App, Component, Modal, MarkdownRenderer, Notice } from "obsidian";
import type PMPlugin from "../main";
import { Project, Task, makeTask } from "../types";
import { flattenTasks } from "../store/TaskTreeOps";
import { safeAsync, getDefaultStatusId } from "../utils";
import { renderStatusDot } from "../ui/StatusBadge";
import { confirmDialog } from "../ui/ModalFactory";
import { renderTaskFormFields } from "./TaskFormFields";
import { renderTimeTrackingPanel } from "./TimeTrackingPanel";
import { renderSubtasksPanel } from "./SubtasksPanel";
import { NoteLinkSuggest } from "./NoteLinkSuggest";

export class TaskModal extends Modal {
  private task: Task;
  private isNew: boolean;
  private originalParentId: string | null;
  private cancelled = false;
  private saved = false;
  private noteSuggest: NoteLinkSuggest | null = null;

  constructor(
    app: App,
    private plugin: PMPlugin,
    private project: Project,
    task: Task | null,
    private parentId: string | null,
    private onSave: (task: Task) => void | Promise<void>,
    defaults?: Partial<Task>,
  ) {
    super(app);
    if (task) {
      this.task = JSON.parse(JSON.stringify(task)) as Task;
      this.isNew = false;
      // Compute current parentId from tree if not explicitly provided
      if (parentId == null) {
        const flat = flattenTasks(project.tasks);
        const entry = flat.find((f) => f.task.id === task.id);
        this.parentId = entry?.parentId ?? null;
      }
    } else {
      this.task = makeTask({
        status: getDefaultStatusId(plugin.settings.statuses),
        priority: "medium",
        ...defaults,
      });
      this.isNew = true;
    }
    this.originalParentId = this.parentId;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pm-task-modal");
    this.modalEl.addClass("pm-modal");
    this.render();
  }

  onClose(): void {
    if (!this.cancelled && !this.saved && this.task.title.trim()) {
      void this.persistTask();
    }
    this.noteSuggest?.destroy();
    this.noteSuggest = null;
    this.contentEl.empty();
  }

  private async persistTask(): Promise<void> {
    if (this.isNew) {
      await this.plugin.store.insertTask(this.project, this.task, this.parentId);
    } else if (this.parentId !== this.originalParentId) {
      await this.plugin.store.updateTask(this.project, this.task.id, this.task);
      await this.plugin.store.moveTask(this.project, this.task.id, this.parentId);
    } else {
      await this.plugin.store.updateTask(this.project, this.task.id, this.task);
    }
    if (this.plugin.settings.autoSchedule) {
      await this.plugin.store.scheduleAfterChange(
        this.project,
        this.task.id,
        this.plugin.settings.statuses,
      );
    }
    await this.onSave(this.task);
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    // ── Header ──────────────────────────────────────────────────────────────
    const header = contentEl.createDiv("pm-modal-header");
    renderStatusDot(header, this.task.status, this.plugin.settings.statuses, "pm-modal-status-dot");

    const titleInput = header.createEl("input", {
      type: "text",
      cls: "pm-modal-title-input",
      value: this.task.title,
    });
    titleInput.placeholder = "Task title\u2026";
    titleInput.addEventListener("input", () => {
      this.task.title = titleInput.value;
    });
    titleInput.focus();
    titleInput.select();

    // ── Description (preview / edit) ─────────────────────────────────────────
    const descSection = contentEl.createDiv("pm-modal-section pm-modal-desc-section");
    descSection.createEl("h4", { text: "Description", cls: "pm-modal-section-title" });

    const descPreview = descSection.createDiv("pm-modal-desc-preview");
    const descArea = descSection.createEl("textarea", { cls: "pm-modal-description" });
    descArea.placeholder = "Add a description\u2026";
    descArea.value = this.task.description;

    const autoResize = () => {
      const saved: [HTMLElement, number][] = [];
      let ancestor = descArea.parentElement;
      while (ancestor) {
        if (ancestor.scrollTop > 0) saved.push([ancestor, ancestor.scrollTop]);
        ancestor = ancestor.parentElement;
      }
      descArea.setCssProps({ "--desc-height": "auto" });
      descArea.setCssProps({ "--desc-height": descArea.scrollHeight + "px" });
      for (const [el, top] of saved) el.scrollTop = top;
    };

    const hasContent = () => this.task.description.trim().length > 0;
    const sourcePath = this.task.filePath || this.project.filePath || "";

    let descComp = new Component();
    descComp.load();

    const toggleCheckbox = (index: number) => {
      let count = 0;
      this.task.description = this.task.description.replace(
        /^([ \t]*[-*+] \[)([ x])(\])/gm,
        (match, pre, state, post) => {
          if (count++ === index) return pre + (state === " " ? "x" : " ") + post;
          return match;
        },
      );
      descArea.value = this.task.description;
      void renderPreview();
    };

    const attachCheckboxListeners = () => {
      descPreview.querySelectorAll('input[type="checkbox"]').forEach((el, i) => {
        const cb = el as HTMLInputElement;
        cb.removeAttribute("disabled");
        cb.addEventListener("click", (e) => {
          e.preventDefault();
          toggleCheckbox(i);
        });
      });
    };

    const renderPreview = async () => {
      descComp.unload();
      descComp = new Component();
      descComp.load();
      descPreview.empty();
      await MarkdownRenderer.render(
        this.app,
        this.task.description,
        descPreview,
        sourcePath,
        descComp,
      );
      attachCheckboxListeners();
    };

    const showEdit = () => {
      descPreview.classList.add("pm-hidden");
      descArea.classList.remove("pm-hidden");
      descArea.value = this.task.description;
      setTimeout(() => {
        autoResize();
        descArea.focus();
      }, 0);
    };

    const showPreview = () => {
      if (!hasContent()) return;
      void renderPreview();
      descArea.classList.add("pm-hidden");
      descPreview.classList.remove("pm-hidden");
    };

    descArea.addEventListener("input", () => {
      this.task.description = descArea.value;
      autoResize();
    });
    descArea.addEventListener("blur", () => showPreview());

    // Note link suggest (inline [[ autocomplete)
    this.noteSuggest?.destroy();
    this.noteSuggest = new NoteLinkSuggest(this.app, descArea, (newValue) => {
      this.task.description = newValue;
      autoResize();
    });
    this.noteSuggest.attach(descSection);

    descPreview.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement && target.type === "checkbox") return;

      const link = target.closest("a");

      if (link) {
        // Internal link (Obsidian note link)
        if (link.classList.contains("internal-link")) {
          e.preventDefault();
          e.stopPropagation();
          const href = link.getAttribute("data-href") || link.getAttribute("href") || "";
          this.saved = false;
          this.cancelled = false;
          this.close();
          void this.app.workspace.openLinkText(href, sourcePath);
          return;
        }
        // External link - let browser handle it
        return;
      }

      // Click on non-link text = edit
      showEdit();
    });

    if (hasContent()) {
      descArea.classList.add("pm-hidden");
      void renderPreview();
    } else {
      descPreview.classList.add("pm-hidden");
      setTimeout(autoResize, 0);
    }

    // ── Properties ─────────────────────────────────────────────────────────
    const propsContainer = contentEl.createDiv("pm-modal-props-container");
    const props = propsContainer.createDiv("pm-modal-props");

    renderTaskFormFields(props, {
      task: this.task,
      project: this.project,
      plugin: this.plugin,
      parentId: this.parentId,
      setParentId: (id) => {
        this.parentId = id;
      },
      rerender: () => this.render(),
    });

    // ── Time Tracking ───────────────────────────────────────────────────────
    renderTimeTrackingPanel(contentEl, this.task);

    // ── Subtasks ────────────────────────────────────────────────────────────
    renderSubtasksPanel(contentEl, this.task, this.plugin);

    // ── Footer ──────────────────────────────────────────────────────────────
    const footer = contentEl.createDiv("pm-modal-footer");

    if (!this.isNew) {
      if (this.task.archived) {
        const unarchiveBtn = footer.createEl("button", {
          text: "Unarchive",
          cls: "pm-btn pm-btn-ghost",
        });
        unarchiveBtn.addEventListener(
          "click",
          safeAsync(async () => {
            await this.plugin.store.unarchiveTask(this.project, this.task.id);
            new Notice("Task unarchived");
            await this.onSave(this.task);
            this.cancelled = true;
            this.close();
          }),
        );
      } else {
        const archiveBtn = footer.createEl("button", {
          text: "Archive",
          cls: "pm-btn pm-btn-ghost",
        });
        archiveBtn.addEventListener(
          "click",
          safeAsync(async () => {
            await this.plugin.store.archiveTask(this.project, this.task.id);
            new Notice("Task archived");
            await this.onSave(this.task);
            this.cancelled = true;
            this.close();
          }),
        );
      }

      const deleteBtn = footer.createEl("button", { text: "Delete", cls: "pm-btn pm-btn-danger" });
      deleteBtn.addEventListener(
        "click",
        safeAsync(async () => {
          if (await confirmDialog(this.app, `Delete "${this.task.title}"?`)) {
            await this.plugin.store.deleteTask(this.project, this.task.id);
            await this.onSave(this.task);
            this.cancelled = true;
            this.close();
          }
        }),
      );
    }

    footer.createDiv("pm-footer-spacer");

    const cancelBtn = footer.createEl("button", { text: "Cancel", cls: "pm-btn pm-btn-ghost" });
    cancelBtn.addEventListener("click", () => {
      this.cancelled = true;
      this.close();
    });

    const saveBtn = footer.createEl("button", {
      text: this.isNew ? "Create (Shift+Enter)" : "Save (Shift+Enter)",
      cls: "pm-btn pm-btn-primary",
    });
    let saving = false;
    const doSave = safeAsync(async () => {
      if (saving) return;
      saving = true;
      if (!this.task.title.trim()) {
        saving = false;
        titleInput.focus();
        titleInput.classList.add("pm-input-error");
        return;
      }
      await this.persistTask();
      this.saved = true;
      this.close();
    });

    saveBtn.addEventListener("click", doSave);
    this.modalEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        doSave();
      }
    });
  }
}

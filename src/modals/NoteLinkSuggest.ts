import { App, prepareFuzzySearch, TFile } from 'obsidian';

/**
 * Inline note-link suggest dropdown for textareas.
 * Triggers on `[[` and shows matching vault markdown files.
 */
export class NoteLinkSuggest {
  private container: HTMLDivElement;
  private mirror: HTMLDivElement;
  private items: TFile[] = [];
  private activeIndex = 0;
  private open = false;
  private query = '';
  private triggerStart = -1; // position of the first `[`

  constructor(
    private app: App,
    private textarea: HTMLTextAreaElement,
    private onInsert: (newValue: string) => void,
  ) {
    this.container = createDiv('pm-note-suggest');
    this.container.style.display = 'none';

    this.mirror = createDiv('pm-note-suggest-mirror');
    this.mirror.style.cssText =
      'position:fixed;top:-9999px;left:-9999px;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;overflow:hidden;';

    document.body.appendChild(this.mirror);

    this.textarea.addEventListener('input', this.onInput);
    this.textarea.addEventListener('keydown', this.onKeydown);
    this.textarea.addEventListener('blur', this.onBlur);
    this.textarea.addEventListener('scroll', this.onScroll);
  }

  /** Must be called to attach the dropdown to the DOM. */
  attach(parent: HTMLElement): void {
    parent.appendChild(this.container);
  }

  destroy(): void {
    this.textarea.removeEventListener('input', this.onInput);
    this.textarea.removeEventListener('keydown', this.onKeydown);
    this.textarea.removeEventListener('blur', this.onBlur);
    this.textarea.removeEventListener('scroll', this.onScroll);
    this.container.remove();
    this.mirror.remove();
  }

  // ── Event handlers ──────────────────────────────────────────────────────

  private onInput = (): void => {
    const pos = this.textarea.selectionStart;
    const text = this.textarea.value.slice(0, pos);
    const match = text.match(/\[\[([^\]]{0,80})$/);

    if (match) {
      this.triggerStart = pos - match[0].length;
      this.query = match[1];
      this.updateItems();
      if (this.items.length > 0) {
        this.show();
      } else {
        this.hide();
      }
    } else {
      this.hide();
    }
  };

  private onKeydown = (e: KeyboardEvent): void => {
    if (!this.open) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        this.activeIndex = (this.activeIndex + 1) % this.items.length;
        this.renderItems();
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        this.activeIndex = (this.activeIndex - 1 + this.items.length) % this.items.length;
        this.renderItems();
        break;
      case 'Enter':
      case 'Tab':
        e.preventDefault();
        e.stopPropagation();
        this.accept(this.items[this.activeIndex]);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.hide();
        break;
    }
  };

  private onBlur = (): void => {
    // Delay to allow click on suggestion item
    setTimeout(() => this.hide(), 150);
  };

  private onScroll = (): void => {
    if (this.open) this.position();
  };

  // ── Core logic ──────────────────────────────────────────────────────────

  private updateItems(): void {
    const files = this.app.vault.getMarkdownFiles();
    if (!this.query) {
      // Show recently modified files when no query
      this.items = files
        .sort((a, b) => b.stat.mtime - a.stat.mtime)
        .slice(0, 8);
    } else {
      const fuzzy = prepareFuzzySearch(this.query);
      const scored: { file: TFile; score: number }[] = [];
      for (const file of files) {
        // Search against basename and full path
        const nameResult = fuzzy(file.basename);
        const pathResult = fuzzy(file.path);
        const score = Math.min(
          nameResult?.score ?? Infinity,
          pathResult?.score ?? Infinity,
        );
        if (score < Infinity) {
          scored.push({ file, score });
        }
      }
      scored.sort((a, b) => a.score - b.score);
      this.items = scored.slice(0, 8).map(s => s.file);
    }
    this.activeIndex = 0;
  }

  private accept(file: TFile): void {
    if (!file) return;
    const before = this.textarea.value.slice(0, this.triggerStart);
    const after = this.textarea.value.slice(this.textarea.selectionStart);
    const insertion = `[[${file.basename}]]`;
    const newValue = before + insertion + after;
    this.textarea.value = newValue;
    const cursorPos = before.length + insertion.length;
    this.textarea.setSelectionRange(cursorPos, cursorPos);
    this.onInsert(newValue);
    this.hide();
    this.textarea.focus();
  }

  private show(): void {
    this.open = true;
    this.container.style.display = '';
    this.position();
    this.renderItems();
  }

  private hide(): void {
    if (!this.open) return;
    this.open = false;
    this.container.style.display = 'none';
    this.triggerStart = -1;
  }

  // ── Positioning ─────────────────────────────────────────────────────────

  private position(): void {
    // Sync mirror styles with textarea
    const style = window.getComputedStyle(this.textarea);
    const props = [
      'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'boxSizing', 'wordWrap', 'whiteSpace', 'overflowWrap',
    ] as const;
    for (const p of props) {
      this.mirror.style.setProperty(
        p.replace(/[A-Z]/g, c => '-' + c.toLowerCase()),
        style.getPropertyValue(p.replace(/[A-Z]/g, c => '-' + c.toLowerCase())),
      );
    }
    this.mirror.style.width = this.textarea.clientWidth + 'px';

    // Copy text up to cursor, add a marker span
    const textToCursor = this.textarea.value.slice(0, this.textarea.selectionStart);
    this.mirror.textContent = '';
    const textNode = document.createTextNode(textToCursor);
    this.mirror.appendChild(textNode);
    const marker = document.createElement('span');
    marker.textContent = '\u200b'; // zero-width space
    this.mirror.appendChild(marker);

    const markerTop = marker.offsetTop;
    const markerLeft = marker.offsetLeft;
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;

    // Position relative to textarea
    const taRect = this.textarea.getBoundingClientRect();
    const parentRect = this.container.offsetParent
      ? (this.container.offsetParent as HTMLElement).getBoundingClientRect()
      : taRect;

    const top = taRect.top - parentRect.top + markerTop - this.textarea.scrollTop + lineHeight + 4;
    const left = taRect.left - parentRect.left + markerLeft;

    this.container.style.top = top + 'px';
    this.container.style.left = left + 'px';

    // Clamp to not overflow right side of modal
    const parentWidth = (this.container.offsetParent as HTMLElement)?.clientWidth ?? 600;
    const maxLeft = parentWidth - 280;
    if (left > maxLeft) {
      this.container.style.left = Math.max(0, maxLeft) + 'px';
    }
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  private renderItems(): void {
    this.container.empty();
    this.items.forEach((file, i) => {
      const row = this.container.createDiv({
        cls: 'pm-note-suggest-item' + (i === this.activeIndex ? ' pm-note-suggest-item--active' : ''),
      });
      row.createDiv({ cls: 'pm-note-suggest-name', text: file.basename });
      if (file.parent && file.parent.path !== '/') {
        row.createDiv({ cls: 'pm-note-suggest-path', text: file.parent.path });
      }
      row.addEventListener('mousedown', (e) => {
        e.preventDefault(); // prevent blur
        this.accept(file);
      });
      row.addEventListener('mouseenter', () => {
        this.activeIndex = i;
        this.renderItems();
      });
    });

    // Scroll active item into view
    const activeEl = this.container.querySelector('.pm-note-suggest-item--active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }
}

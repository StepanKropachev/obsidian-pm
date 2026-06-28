import { setIcon } from 'obsidian'
import { Popover } from '../../primitives/Popover'
import { Chip } from '../../primitives/Chip'
import { Avatar } from '../../primitives/Avatar'
import { renderOptionRow } from './optionList'

export interface PickerItem {
  id: string
  label: string
  color?: string
  icon?: string
}

export interface MultiSelectOpts {
  container: HTMLElement
  selected: () => string[]
  options: () => PickerItem[]
  add: (id: string) => void
  remove: (id: string) => void
  addLabel: string
  /** Add-ghost label once at least one value is present (e.g. "Add another"). */
  addLabelMore?: string
  labelFor?: (id: string) => string
  colorFor?: (id: string) => string
  search?: boolean
  placeholder?: string
  /** Header shown above the picker options. */
  menuLabel?: string
  create?: (label: string) => void
  tag?: boolean
  /** Render the value as a single trigger holding an overlapping avatar stack. Backs Assignees. */
  avatarStack?: boolean
  /** Render the values as a vertical list of id + title-link rows. Backs Depends on. */
  depsList?: boolean
}

/**
 * Multi-value inline control: shows the current values and an add affordance that opens a
 * searchable picker popover. The popover stays open across toggles so several values can be
 * added at once. Backs Tags, Assignees, and Depends on.
 *
 * Two value displays: chips (default) with a trailing add ghost, or a single avatar-stack
 * trigger (`avatarStack`) that doubles as the picker anchor.
 */
export function renderMultiSelect(opts: MultiSelectOpts): void {
  const labelOf = (id: string) => (opts.labelFor ? opts.labelFor(id) : id)
  const stackMode = !!opts.avatarStack
  const listMode = !!opts.depsList

  // The picker anchor. In stack mode the trigger itself is the anchor and the value display;
  // otherwise the values sit in their own row (chips, or a deps list) above a trailing ghost
  // that anchors the picker.
  const chipsEl = stackMode || listMode ? null : opts.container.createDiv('pm-prop-chips')
  const depsEl = listMode ? opts.container.createDiv('pm-prop-deps') : null
  const anchorBtn = stackMode
    ? opts.container.createEl('button')
    : opts.container.createEl('button', { cls: 'pm-prop-add' })
  let addLabelEl: HTMLElement | null = null
  if (!stackMode) {
    setIcon(anchorBtn.createSpan({ cls: 'pm-glyph-icon' }), 'plus')
    addLabelEl = anchorBtn.createSpan({ cls: 'pm-prop-add-label', text: opts.addLabel })
  }

  const renderStackTrigger = () => {
    anchorBtn.empty()
    const ids = opts.selected()
    if (ids.length === 0) {
      anchorBtn.className = 'pm-prop-add'
      setIcon(anchorBtn.createSpan({ cls: 'pm-glyph-icon' }), 'plus')
      anchorBtn.createSpan({ cls: 'pm-prop-add-label', text: opts.addLabel })
      return
    }
    anchorBtn.className = 'pm-prop-inline pm-assignees-trigger'
    const stack = anchorBtn.createSpan({ cls: 'pm-avatar-stack' })
    for (const id of ids) new Avatar(stack).setName(labelOf(id)).setSize('sm')
    if (ids.length === 1) {
      anchorBtn.createSpan({ cls: 'pm-assignees-label', text: labelOf(ids[0]) })
    }
  }

  const renderChips = () => {
    if (!chipsEl) return
    chipsEl.empty()
    for (const id of opts.selected()) {
      const chip = new Chip(chipsEl)
        .setLabel(labelOf(id))
        .setVariant('outline')
        .setRemovable(() => {
          opts.remove(id)
          renderValues()
        })
      if (opts.tag) chip.setTag()
      else chip.setShape('pill')
      const color = opts.colorFor?.(id)
      if (color) chip.setDot(true).setColor(color)
    }
  }

  // Depends on: one row per value (link icon + mono id + title link + remove).
  const renderDepsList = () => {
    if (!depsEl) return
    depsEl.empty()
    for (const id of opts.selected()) {
      const row = depsEl.createDiv('pm-dep-row')
      setIcon(row.createSpan({ cls: 'pm-dep-icon' }), 'link-2')
      row.createSpan({ cls: 'pm-dep-id', text: id })
      row.createSpan({ cls: 'pm-dep-title', text: labelOf(id) })
      const rm = row.createEl('button', { cls: 'pm-chip-rm' })
      setIcon(rm, 'x')
      rm.addEventListener('click', () => {
        opts.remove(id)
        renderValues()
      })
    }
  }

  const renderValues = () => {
    if (stackMode) renderStackTrigger()
    else if (listMode) renderDepsList()
    else renderChips()
    if (addLabelEl) {
      addLabelEl.setText(opts.selected().length && opts.addLabelMore ? opts.addLabelMore : opts.addLabel)
    }
  }
  renderValues()

  let pop: Popover | null = null
  anchorBtn.addEventListener('click', () => {
    if (pop?.isOpen) {
      pop.close()
      return
    }
    const popover = new Popover({ anchor: anchorBtn, width: 230, onClose: () => (pop = null) })
    pop = popover
    let query = ''
    if (opts.menuLabel) popover.contentEl.createDiv({ cls: 'pm-pop-label', text: opts.menuLabel })
    const searchInput = opts.search
      ? popover.contentEl.createEl('input', {
          cls: 'pm-pop-field',
          attr: { placeholder: opts.placeholder ?? 'Search…', spellcheck: 'false' }
        })
      : null
    const listEl = popover.contentEl.createDiv('pm-pop-list')

    const renderList = () => {
      listEl.empty()
      const q = query.trim().toLowerCase()
      const selectedIds = new Set(opts.selected())
      const items = opts.options().filter((it) => !q || it.label.toLowerCase().includes(q))
      for (const it of items) {
        renderOptionRow(listEl, {
          label: it.label,
          color: it.color ?? opts.colorFor?.(it.id),
          icon: it.icon,
          avatar: stackMode ? it.label : undefined,
          selected: selectedIds.has(it.id),
          onPick: () => {
            if (selectedIds.has(it.id)) opts.remove(it.id)
            else opts.add(it.id)
            renderValues()
            renderList()
          }
        })
      }
      const create = opts.create
      if (create && q && !opts.options().some((it) => it.label.toLowerCase() === q)) {
        const label = query.trim()
        renderOptionRow(listEl, {
          label: `Create "${label}"`,
          icon: 'plus',
          accent: true,
          onPick: () => {
            create(label)
            query = ''
            if (searchInput) searchInput.value = ''
            renderValues()
            renderList()
          }
        })
      }
    }

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        query = searchInput.value
        renderList()
      })
    }

    renderList()
    popover.open()
    searchInput?.focus()
  })
}

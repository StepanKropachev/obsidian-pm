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
  labelFor?: (id: string) => string
  colorFor?: (id: string) => string
  search?: boolean
  placeholder?: string
  create?: (label: string) => void
  chipShape?: 'pill' | 'rounded'
  tag?: boolean
  /** Render the value as a single trigger holding an overlapping avatar stack plus
      a name / "N people" label, instead of one chip per value. Backs Assignees. */
  avatarStack?: boolean
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

  // The picker anchor. In stack mode the trigger itself is the anchor and the value display;
  // otherwise the chips sit in their own row and a trailing ghost anchors the picker.
  const chipsEl = stackMode ? null : opts.container.createDiv('pm-prop-chips')
  const anchorBtn = stackMode
    ? opts.container.createEl('button')
    : opts.container.createEl('button', { cls: 'pm-prop-add' })
  if (!stackMode) {
    setIcon(anchorBtn.createSpan({ cls: 'pm-glyph-icon' }), 'plus')
    anchorBtn.createSpan({ cls: 'pm-prop-add-label', text: opts.addLabel })
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
    anchorBtn.createSpan({
      cls: 'pm-assignees-label',
      text: ids.length === 1 ? labelOf(ids[0]) : `${ids.length} people`
    })
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
      else chip.setShape(opts.chipShape ?? 'pill')
      const color = opts.colorFor?.(id)
      if (color) chip.setDot(true).setColor(color)
    }
  }

  const renderValues = stackMode ? renderStackTrigger : renderChips
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
    let searchInput: HTMLInputElement | null = null
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

    if (opts.search) {
      const input = popover.contentEl.createEl('input', {
        cls: 'pm-pop-field',
        attr: { placeholder: opts.placeholder ?? 'Search…', spellcheck: 'false' }
      })
      input.addEventListener('input', () => {
        query = input.value
        renderList()
      })
      popover.contentEl.prepend(input)
      searchInput = input
    }

    renderList()
    popover.open()
    searchInput?.focus()
  })
}

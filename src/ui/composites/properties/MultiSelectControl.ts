import { setIcon } from 'obsidian'
import { safeAsync } from '../../../utils'
import { Popover } from '../../primitives/Popover'
import { Chip } from '../../primitives/Chip'
import { Avatar } from '../../primitives/Avatar'
import { renderDepRow, type DepLink } from './depRow'
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
  /** Identity a selected value is matched by, so the same person written two ways is one row. */
  keyOf?: (id: string) => string
  search?: boolean
  placeholder?: string
  /** A second tier, searched only once the user types: vault notes behind the known values. */
  moreOptions?: (query: string) => PickerItem[]
  moreHeading?: string
  create?: (label: string) => void
  /** Row label for the create option; defaults to `Create "<name>"`. */
  createLabel?: (name: string) => string
  /** A second create row, e.g. creating the note a person links to. Awaited before repaint. */
  createAlt?: { label: (name: string) => string; icon: string; run: (name: string) => Promise<void> }
  tag?: boolean
  /** One trigger holding an overlapping avatar stack. Backs Assignees. */
  avatarStack?: boolean
  /** A vertical list of id + title-link rows. Backs Depends on. */
  depsList?: boolean
  /** The note a deps-list value stands for, turning its title into a link that opens it. */
  linkFor?: (id: string) => DepLink | null
}

/**
 * Backs Tags, Assignees, and Depends on. The picker popover stays open across toggles so
 * several values can be added at once.
 */
export function renderMultiSelect(opts: MultiSelectOpts): void {
  const labelOf = (id: string) => (opts.labelFor ? opts.labelFor(id) : id)
  const keyOf = (id: string) => (opts.keyOf ? opts.keyOf(id) : id)
  const stackMode = !!opts.avatarStack
  const listMode = !!opts.depsList

  // In stack mode the trigger is both the anchor and the value display; otherwise the values
  // sit in their own row above a trailing ghost that anchors the picker.
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

  const renderDepsList = () => {
    if (!depsEl) return
    depsEl.empty()
    for (const id of opts.selected()) {
      renderDepRow(depsEl, {
        id,
        title: labelOf(id),
        link: opts.linkFor?.(id),
        onRemove: () => {
          opts.remove(id)
          renderValues()
        }
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
      const picked = new Map(opts.selected().map((value) => [keyOf(value), value]))
      const items = opts.options().filter((it) => !q || it.label.toLowerCase().includes(q))
      const toggle = (id: string) => {
        const current = picked.get(keyOf(id))
        if (current !== undefined) opts.remove(current)
        else opts.add(id)
        renderValues()
        renderList()
      }
      for (const it of items) {
        renderOptionRow(listEl, {
          label: it.label,
          color: it.color ?? opts.colorFor?.(it.id),
          icon: it.icon,
          avatar: stackMode ? it.label : undefined,
          selected: picked.has(keyOf(it.id)),
          onPick: () => toggle(it.id)
        })
      }
      const more = q ? (opts.moreOptions?.(query.trim()) ?? []) : []
      const known = new Set(items.map((it) => keyOf(it.id)))
      const extra = more.filter((it) => !known.has(keyOf(it.id)))
      if (extra.length && opts.moreHeading) {
        listEl.createDiv({ cls: 'pm-pop-heading', text: opts.moreHeading })
      }
      for (const it of extra) {
        renderOptionRow(listEl, {
          label: it.label,
          icon: it.icon,
          avatar: stackMode ? it.label : undefined,
          selected: picked.has(keyOf(it.id)),
          onPick: () => toggle(it.id)
        })
      }

      const create = opts.create
      const matched = [...items, ...extra].some((it) => it.label.toLowerCase() === q)
      if (create && q && !matched) {
        const label = query.trim()
        renderOptionRow(listEl, {
          label: opts.createLabel ? opts.createLabel(label) : `Create "${label}"`,
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

      const createAlt = opts.createAlt
      if (createAlt && q && !matched) {
        const label = query.trim()
        renderOptionRow(listEl, {
          label: createAlt.label(label),
          icon: createAlt.icon,
          accent: true,
          onPick: safeAsync(async () => {
            await createAlt.run(label)
            query = ''
            if (searchInput) searchInput.value = ''
            renderValues()
            renderList()
          })
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

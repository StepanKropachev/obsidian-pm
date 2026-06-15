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
  avatar?: boolean
  chipShape?: 'pill' | 'rounded'
}

/**
 * Multi-value inline control: renders the current values as chips (or avatars) and an add
 * affordance that opens a searchable picker popover. The popover stays open across toggles so
 * several values can be added at once. Backs Tags, Assignees, and Depends on.
 */
export function renderMultiSelect(opts: MultiSelectOpts): void {
  const labelOf = (id: string) => (opts.labelFor ? opts.labelFor(id) : id)
  const chipsEl = opts.container.createDiv('pm-prop-chips')
  const addBtn = opts.container.createEl('button', { cls: 'pm-prop-add' })
  const addIcon = addBtn.createSpan({ cls: 'pm-glyph-icon' })
  setIcon(addIcon, 'plus')
  addBtn.createSpan({ cls: 'pm-prop-add-label', text: opts.addLabel })

  const renderChips = () => {
    chipsEl.empty()
    for (const id of opts.selected()) {
      if (opts.avatar) {
        const chip = chipsEl.createDiv('pm-assignee-chip')
        new Avatar(chip).setName(labelOf(id)).setSize('sm')
        chip.createSpan({ cls: 'pm-assignee-name', text: labelOf(id) })
        const rm = chip.createEl('button', { cls: 'pm-chip-rm' })
        setIcon(rm, 'x')
        rm.addEventListener('click', () => {
          opts.remove(id)
          renderChips()
        })
      } else {
        const chip = new Chip(chipsEl)
          .setLabel(labelOf(id))
          .setShape(opts.chipShape ?? 'pill')
          .setVariant('outline')
          .setRemovable(() => {
            opts.remove(id)
            renderChips()
          })
        const color = opts.colorFor?.(id)
        if (color) chip.setDot(true).setColor(color)
      }
    }
  }
  renderChips()

  let pop: Popover | null = null
  addBtn.addEventListener('click', () => {
    if (pop?.isOpen) {
      pop.close()
      return
    }
    const popover = new Popover({ anchor: addBtn, width: 230, onClose: () => (pop = null) })
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
          color: it.color,
          icon: it.icon,
          selected: selectedIds.has(it.id),
          onPick: () => {
            if (selectedIds.has(it.id)) opts.remove(it.id)
            else opts.add(it.id)
            renderChips()
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
            renderChips()
            renderList()
          }
        })
      }
    }

    if (opts.search) {
      const input = popover.contentEl.createEl('input', {
        cls: 'pm-pop-field',
        attr: { placeholder: opts.placeholder ?? 'Search…' }
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

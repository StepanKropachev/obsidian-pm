import { setIcon } from 'obsidian'
import { Avatar } from '../../primitives/Avatar'

export interface SelectItem {
  id: string
  label: string
  color?: string
  icon?: string
}

export interface GlyphSpec {
  color?: string
  icon?: string
}

/** Renders a leading glyph for an option: a tinted icon if `icon` is set, else a colored dot. */
export function renderGlyph(parent: HTMLElement, spec: GlyphSpec): void {
  if (spec.icon) {
    const ic = parent.createSpan({ cls: 'pm-glyph-icon' })
    setIcon(ic, spec.icon)
    if (spec.color) ic.setCssProps({ '--pm-glyph-color': spec.color })
  } else if (spec.color) {
    const dot = parent.createSpan({ cls: 'pm-glyph-dot' })
    dot.setCssProps({ '--pm-glyph-color': spec.color })
  }
}

export interface OptionRow extends GlyphSpec {
  label: string
  selected?: boolean
  accent?: boolean
  /** Render a leading avatar (initials from this name) instead of a glyph. Used by the
      assignee picker. */
  avatar?: string
  onPick: () => void
}

/** Renders one selectable row (glyph/avatar + label + optional check) into a popover list. */
export function renderOptionRow(parent: HTMLElement, row: OptionRow): HTMLElement {
  const item = parent.createEl('button', { cls: 'pm-pop-item' })
  if (row.accent) item.addClass('pm-pop-item--accent')
  if (row.avatar) new Avatar(item).setName(row.avatar).setSize('sm')
  else renderGlyph(item, row)
  item.createSpan({ cls: 'pm-pop-item-label', text: row.label })
  if (row.selected) {
    const check = item.createSpan({ cls: 'pm-pop-check' })
    setIcon(check, 'check')
  }
  item.addEventListener('click', row.onPick)
  return item
}

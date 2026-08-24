import { setIcon, setTooltip } from 'obsidian'
import { IconButton } from '../../primitives/IconButton'

/** The note a row's task lives in, and what activating the row leads to. */
export interface DepLink {
  path: string
  open: () => void
}

export interface DepRowProps {
  id: string
  title: string
  link?: DepLink | null
  tooltip?: string
  onRemove?: () => void
}

/**
 * One task in a dependency list: link icon, task id, title, and a remove button when the
 * list is editable. Backs both Depends on and Blocks, so the two read the same.
 */
export function renderDepRow(parent: HTMLElement, props: DepRowProps): HTMLElement {
  const row = parent.createDiv('pm-dep-row')
  setIcon(row.createSpan({ cls: 'pm-dep-icon' }), 'link-2')
  row.createSpan({ cls: 'pm-dep-id', text: props.id })
  const link = props.link
  if (!link) {
    row.createSpan({ cls: 'pm-dep-title', text: props.title })
  } else {
    // No href: every way of activating the link goes through the handler, which opens the
    // task rather than the markdown behind it.
    const titleEl = row.createEl('a', {
      cls: 'pm-dep-title internal-link',
      text: props.title,
      attr: { 'data-href': link.path, role: 'link', tabindex: '0' }
    })
    titleEl.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      link.open()
    })
    titleEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      e.stopPropagation()
      link.open()
    })
  }
  if (props.tooltip) setTooltip(row, props.tooltip)
  if (props.onRemove) {
    new IconButton(row).setIcon('x').setTooltip('Remove dependency').onClick(props.onRemove)
  }
  return row
}

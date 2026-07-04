import { setIcon } from 'obsidian'
import { renderAddButton } from '../addButton'
import { Popover } from '../../primitives/Popover'

export interface HiddenProperty {
  id: string
  label: string
  icon: string
}

/**
 * Progressive-disclosure affordance: an "Add property" button that lists the currently hidden
 * (empty, rarely-used) properties in a popover and reveals the chosen one.
 */
export function renderAddProperty(
  container: HTMLElement,
  hidden: HiddenProperty[],
  onShow: (id: string) => void
): void {
  if (hidden.length === 0) return
  let pop: Popover | null = null
  const btn = renderAddButton(container, 'Add property', () => {
    if (pop?.isOpen) {
      pop.close()
      return
    }
    pop = new Popover({ anchor: btn, width: 190, onClose: () => (pop = null) })
    const list = pop.contentEl.createDiv('pm-pop-list')
    for (const h of hidden) {
      const item = list.createEl('button', { cls: 'pm-pop-item' })
      const ic = item.createSpan({ cls: 'pm-glyph-icon' })
      setIcon(ic, h.icon)
      item.createSpan({ cls: 'pm-pop-item-label', text: h.label })
      item.addEventListener('click', () => {
        pop?.close()
        onShow(h.id)
      })
    }
    pop.open()
  })
}

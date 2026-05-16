import { setIcon } from 'obsidian'

export interface ExpandCellProps {
  hasSubtasks: boolean
  collapsed: boolean
  onToggle: () => void
}

export class ExpandCell {
  el: HTMLTableCellElement

  constructor(parentRow: HTMLElement, props: ExpandCellProps) {
    this.el = parentRow.createEl('td', { cls: 'pm-table-cell-expand' })
    if (props.hasSubtasks) {
      const toggle = this.el.createDiv({ cls: 'tree-item-icon collapse-icon' })
      setIcon(toggle, 'right-triangle')
      toggle.toggleClass('is-collapsed', props.collapsed)
      toggle.setAttr('aria-label', props.collapsed ? 'Expand subtasks' : 'Collapse subtasks')
      toggle.addEventListener('click', props.onToggle)
    }
  }
}

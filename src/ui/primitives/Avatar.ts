import { setTooltip } from 'obsidian'
import { displayName, makeActivatable, stringToColor } from '../../utils'

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const raw = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)
  return raw.toUpperCase()
}

export class Avatar {
  el: HTMLSpanElement

  constructor(parentEl: HTMLElement) {
    this.el = parentEl.createSpan({ cls: 'pm-avatar' })
  }

  setName(name: string): this {
    const display = displayName(name)
    this.el.setText(initialsFor(display))
    this.el.style.background = stringToColor(display)
    setTooltip(this.el, display)
    return this
  }

  setSize(size: 'md' | 'sm'): this {
    this.el.toggleClass('pm-avatar--sm', size === 'sm')
    return this
  }

  setUnresolved(unresolved: boolean): this {
    this.el.toggleClass('pm-avatar--unresolved', unresolved)
    return this
  }

  onClick(handler: () => void): this {
    this.el.addClass('pm-avatar--link')
    makeActivatable(this.el, handler)
    return this
  }
}

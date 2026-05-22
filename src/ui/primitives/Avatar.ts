import { setTooltip } from 'obsidian'
import { stringToColor } from '../../utils'

function displayName(raw: string): string {
  const m = raw.trim().match(/^\[\[([^\]]+)\]\]$/)
  if (!m) return raw
  const inner = m[1]
  const pipe = inner.indexOf('|')
  return pipe >= 0 ? inner.slice(pipe + 1) : inner
}

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
}

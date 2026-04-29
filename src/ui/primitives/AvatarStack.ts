import { Avatar } from './Avatar'

export class AvatarStack {
  el: HTMLElement
  private names: string[] = []
  private max = 3
  private size: 'md' | 'sm' = 'md'

  constructor(parentEl: HTMLElement) {
    this.el = parentEl.createDiv('pm-avatar-stack')
  }

  setNames(names: string[]): this {
    this.names = names
    this.render()
    return this
  }

  setMax(max: number): this {
    this.max = max
    this.render()
    return this
  }

  setSize(size: 'md' | 'sm'): this {
    this.size = size
    this.render()
    return this
  }

  private render(): void {
    this.el.empty()
    const visible = this.names.slice(0, this.max)
    for (const name of visible) {
      new Avatar(this.el).setName(name).setSize(this.size)
    }
    const overflow = this.names.length - visible.length
    if (overflow > 0) {
      const more = this.el.createEl('span', { cls: 'pm-avatar pm-avatar--more' })
      more.setText(`+${overflow}`)
      if (this.size === 'sm') more.addClass('pm-avatar--sm')
    }
  }
}

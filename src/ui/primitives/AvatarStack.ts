import { Avatar } from './Avatar'

export interface AvatarPerson {
  name: string
  /** A link that points at no note; rendered muted, as Obsidian renders one. */
  unresolved?: boolean
  onClick?: () => void
}

export class AvatarStack {
  el: HTMLElement
  private people: AvatarPerson[] = []
  private max = 3
  private size: 'md' | 'sm' = 'md'

  constructor(parentEl: HTMLElement) {
    this.el = parentEl.createDiv('pm-avatar-stack')
  }

  setNames(names: string[]): this {
    return this.setPeople(names.map((name) => ({ name })))
  }

  setPeople(people: AvatarPerson[]): this {
    this.people = people
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
    const visible = this.people.slice(0, this.max)
    for (const person of visible) {
      const avatar = new Avatar(this.el).setName(person.name).setSize(this.size)
      if (person.unresolved) avatar.setUnresolved(true)
      if (person.onClick) avatar.onClick(person.onClick)
    }
    const overflow = this.people.length - visible.length
    if (overflow > 0) {
      const more = this.el.createSpan({ cls: 'pm-avatar pm-avatar--more' })
      more.setText(`+${overflow}`)
      if (this.size === 'sm') more.addClass('pm-avatar--sm')
    }
  }
}

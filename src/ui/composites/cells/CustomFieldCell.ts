import { setIcon } from 'obsidian'
import { AvatarStack, type AvatarPerson } from '../../primitives/AvatarStack'

export type CustomFieldValue =
  | { kind: 'text'; text: string }
  | { kind: 'checkbox'; checked: boolean }
  | { kind: 'url'; url: string }
  /** A person field: the same avatars assignees get, opening the person's note. */
  | { kind: 'people'; people: AvatarPerson[] }
  /** Any other value naming a note, shown as the note's name. */
  | { kind: 'links'; links: AvatarPerson[] }

export class CustomFieldCell {
  el: HTMLTableCellElement

  constructor(parentRow: HTMLElement, value: CustomFieldValue) {
    this.el = parentRow.createEl('td', { cls: 'pm-table-cell' })
    switch (value.kind) {
      case 'text':
        this.empty(value.text)
        return
      case 'checkbox':
        if (value.checked) setIcon(this.el.createSpan({ cls: 'pm-glyph-icon' }), 'check')
        else this.empty('')
        return
      case 'url': {
        if (!value.url) {
          this.empty('')
          return
        }
        const link = this.el.createEl('a', { cls: 'external-link', text: value.url, href: value.url })
        link.setAttr('target', '_blank')
        link.setAttr('rel', 'noopener')
        return
      }
      case 'people':
        if (value.people.length === 0) this.empty('')
        else new AvatarStack(this.el).setPeople(value.people).setMax(3)
        return
      case 'links':
        this.renderLinks(value.links)
    }
  }

  private empty(text: string): void {
    this.el.createSpan({ text: text || '—', cls: 'pm-cf-value' })
  }

  private renderLinks(links: AvatarPerson[]): void {
    const value = this.el.createSpan({ cls: 'pm-cf-value' })
    links.forEach((link, i) => {
      if (i > 0) value.createSpan({ text: ', ' })
      const el = value.createSpan({ text: link.name })
      if (!link.onClick && !link.unresolved) return
      el.addClass('pm-cf-link')
      if (link.unresolved) el.addClass('pm-cf-link--unresolved')
      const open = link.onClick
      if (!open) return
      el.setAttr('role', 'link')
      el.setAttr('tabindex', '0')
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        open()
      })
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        e.stopPropagation()
        open()
      })
    })
  }
}

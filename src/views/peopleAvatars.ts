import type { App } from 'obsidian'
import { resolvePeople } from '../store'
import type { AvatarPerson } from '../ui/primitives/AvatarStack'

/** Turns stored assignee values into avatars that open the note behind a linked person. */
export function peopleAvatars(app: App, values: string[], sourcePath: string): AvatarPerson[] {
  return resolvePeople(app, values, sourcePath).map((person) => {
    const path = person.path
    return {
      name: person.name,
      unresolved: person.state === 'unresolved',
      onClick: path ? () => void app.workspace.openLinkText(path, sourcePath) : undefined
    }
  })
}

import type { App } from 'obsidian'
import { resolvePeople } from '../store'
import type { AvatarPerson } from '../ui/primitives/AvatarStack'

/**
 * Turns stored values into references that open the note behind them: assignees and members
 * shown as avatars, any other value naming a note shown as a link.
 */
export function linkedRefs(app: App, values: string[], sourcePath: string): AvatarPerson[] {
  return resolvePeople(app, values, sourcePath).map((person) => {
    const path = person.path
    return {
      name: person.name,
      unresolved: person.state === 'unresolved',
      onClick: path ? () => void app.workspace.openLinkText(path, sourcePath) : undefined
    }
  })
}

import type PMPlugin from '../main'
import type { Project } from '../types'
import { createPersonLink, personCandidates, personKeyer } from '../store'
import { renderMultiSelect } from '../ui/composites/properties'
import { dedupePeople, displayName } from '../utils'

export interface PersonPickerOpts {
  container: HTMLElement
  plugin: PMPlugin
  project: Project
  /** The note the picked value is written into, so its link resolves from there. */
  sourcePath: string
  addLabel: string
  selected: () => string[]
  add: (value: string) => void
  remove: (value: string) => void
}

/**
 * The people picker behind assignees and person custom fields: the project's and the global
 * members first, the vault's person notes once the user types, and rows to add a typed name
 * or create the note for it.
 */
export function renderPersonPicker(opts: PersonPickerOpts): void {
  const { plugin, project, sourcePath } = opts
  const members = () =>
    dedupePeople([...project.teamMembers, ...plugin.settings.globalTeamMembers], personKeyer(plugin.app))
  renderMultiSelect({
    container: opts.container,
    avatarStack: true,
    search: true,
    addLabel: opts.addLabel,
    placeholder: 'Search people…',
    selected: opts.selected,
    labelFor: displayName,
    options: () => members().map((m) => ({ id: m, label: displayName(m) })),
    moreOptions: (query) =>
      personCandidates(plugin.app, plugin.settings.peopleFolder, query, sourcePath).map((c) => ({
        id: c.link,
        label: c.name
      })),
    moreHeading: 'People in your vault',
    add: opts.add,
    remove: opts.remove,
    createLabel: (name) => `Add "${name}"`,
    create: opts.add,
    createAlt: {
      label: (name) => `Create person note "${name}"`,
      icon: 'user-plus',
      run: async (name) => {
        opts.add(await createPersonLink(plugin.app, plugin.settings.peopleFolder, name, sourcePath))
      }
    }
  })
}

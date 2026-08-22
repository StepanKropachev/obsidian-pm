import { SuggestModal, App } from 'obsidian'
import type { Task } from '../types'
import type { ProjectRef } from '../store'

const NEW_TAG_PREFIX = '__new__:'

/** Lists projects from the index, so picking one doesn't load every project in the vault. */
export class ProjectPickerModal extends SuggestModal<ProjectRef> {
  constructor(
    app: App,
    private projects: ProjectRef[],
    private onChoose: (project: ProjectRef) => void
  ) {
    super(app)
    this.setPlaceholder('Pick a project…')
  }

  getSuggestions(query: string): ProjectRef[] {
    const q = query.toLowerCase()
    return this.projects.filter((p) => p.title.toLowerCase().includes(q))
  }

  renderSuggestion(project: ProjectRef, el: HTMLElement): void {
    el.createSpan({ text: `${project.icon} ${project.title}` })
  }

  onChooseSuggestion(project: ProjectRef): void {
    this.onChoose(project)
  }
}

export class TaskPickerModal extends SuggestModal<Task> {
  constructor(
    app: App,
    private tasks: Task[],
    private onChoose: (task: Task) => void,
    placeholder = 'Pick a parent task…'
  ) {
    super(app)
    this.setPlaceholder(placeholder)
  }

  getSuggestions(query: string): Task[] {
    const q = query.toLowerCase()
    return this.tasks.filter((t) => t.title.toLowerCase().includes(q))
  }

  renderSuggestion(task: Task, el: HTMLElement): void {
    el.createSpan({ text: task.title })
  }

  onChooseSuggestion(task: Task): void {
    this.onChoose(task)
  }
}

export class TagPickerModal extends SuggestModal<string> {
  constructor(
    app: App,
    private tags: string[],
    private onChoose: (tag: string) => void
  ) {
    super(app)
    this.setPlaceholder('Search or create a tag…')
  }

  getSuggestions(query: string): string[] {
    const q = query.toLowerCase().trim().replace(/\s+/g, '-')
    const filtered = this.tags.filter((t) => t.includes(q))
    if (q && !this.tags.includes(q)) {
      filtered.unshift(`${NEW_TAG_PREFIX}${q}`)
    }
    return filtered.length ? filtered : q ? [`${NEW_TAG_PREFIX}${q}`] : []
  }

  renderSuggestion(item: string, el: HTMLElement): void {
    if (item.startsWith(NEW_TAG_PREFIX)) {
      const tag = item.slice(NEW_TAG_PREFIX.length)
      el.createSpan({ text: `Create: ${tag}`, cls: 'pm-suggest-create' })
    } else {
      el.createSpan({ text: item })
    }
  }

  onChooseSuggestion(item: string): void {
    const tag = item.startsWith(NEW_TAG_PREFIX) ? item.slice(NEW_TAG_PREFIX.length) : item
    this.onChoose(tag.toLowerCase().replace(/\s+/g, '-'))
  }
}

export interface PersonChoice {
  /** What to store: a wikilink for a person with a note, the plain name otherwise. */
  value: string
  name: string
}

const NEW_PERSON_PREFIX = '__person__:'

/**
 * Picks a person, preferring the notes already in the vault so the stored value is a link
 * Obsidian can follow. Typing a name with no note behind it still stores it as plain text.
 */
export class PersonPickerModal extends SuggestModal<PersonChoice> {
  constructor(
    app: App,
    private known: PersonChoice[],
    private search: (query: string) => PersonChoice[],
    private onChoose: (choice: PersonChoice, create: boolean) => void
  ) {
    super(app)
    this.setPlaceholder('Search people…')
  }

  getSuggestions(query: string): PersonChoice[] {
    const q = query.toLowerCase().trim()
    const known = this.known.filter((p) => !q || p.name.toLowerCase().includes(q))
    const seen = new Set(known.map((p) => p.value))
    const found = this.search(q).filter((p) => !seen.has(p.value))
    const exact = [...known, ...found].some((p) => p.name.toLowerCase() === q)
    const trailing: PersonChoice[] = []
    if (q && !exact) {
      trailing.push({ value: query.trim(), name: query.trim() })
      trailing.push({ value: `${NEW_PERSON_PREFIX}${query.trim()}`, name: query.trim() })
    }
    return [...known, ...found, ...trailing]
  }

  renderSuggestion(item: PersonChoice, el: HTMLElement): void {
    if (item.value.startsWith(NEW_PERSON_PREFIX)) {
      el.createSpan({ text: `Create person note "${item.name}"`, cls: 'pm-suggest-create' })
      return
    }
    el.createSpan({ text: item.name })
    if (item.value !== item.name) el.createSpan({ text: ' · linked', cls: 'pm-suggest-hint' })
  }

  onChooseSuggestion(item: PersonChoice): void {
    if (item.value.startsWith(NEW_PERSON_PREFIX)) {
      this.onChoose({ value: item.name, name: item.name }, true)
      return
    }
    this.onChoose(item, false)
  }
}

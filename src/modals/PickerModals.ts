import { SuggestModal, App } from 'obsidian'
import type { Task } from '../types'
import type { ProjectRef } from '../store'
import { displayName } from '../utils'
import { renderGlyph } from '../ui/composites/properties'

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
    const row = el.createSpan({ cls: 'pm-picker-suggestion' })
    renderGlyph(row, { icon: project.icon, color: project.color })
    row.createSpan({ text: project.title })
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

/** Lists the people already assigned somewhere, for the command that shows their tasks. */
export class PersonLookupModal extends SuggestModal<string> {
  constructor(
    app: App,
    private people: string[],
    private onChoose: (person: string) => void
  ) {
    super(app)
    this.setPlaceholder('Pick a person…')
  }

  getSuggestions(query: string): string[] {
    const q = query.toLowerCase()
    return this.people.filter((person) => displayName(person).toLowerCase().includes(q))
  }

  renderSuggestion(person: string, el: HTMLElement): void {
    el.createSpan({ text: displayName(person) })
  }

  onChooseSuggestion(person: string): void {
    this.onChoose(person)
  }
}

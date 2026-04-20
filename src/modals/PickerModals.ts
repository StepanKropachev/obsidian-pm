import { SuggestModal, App } from 'obsidian'
import type { Project, Task } from '../types'

const NEW_TAG_PREFIX = '__new__:'

export class ProjectPickerModal extends SuggestModal<Project> {
  constructor(
    app: App,
    private projects: Project[],
    private onChoose: (project: Project) => void
  ) {
    super(app)
    this.setPlaceholder('Pick a project…')
  }

  getSuggestions(query: string): Project[] {
    const q = query.toLowerCase()
    return this.projects.filter((p) => p.title.toLowerCase().includes(q))
  }

  renderSuggestion(project: Project, el: HTMLElement): void {
    el.createEl('span', { text: `${project.icon} ${project.title}` })
  }

  onChooseSuggestion(project: Project): void {
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
    el.createEl('span', { text: task.title })
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
      el.createEl('span', { text: `Create: ${tag}`, cls: 'pm-suggest-create' })
    } else {
      el.createEl('span', { text: item })
    }
  }

  onChooseSuggestion(item: string): void {
    const tag = item.startsWith(NEW_TAG_PREFIX) ? item.slice(NEW_TAG_PREFIX.length) : item
    this.onChoose(tag.toLowerCase().replace(/\s+/g, '-'))
  }
}

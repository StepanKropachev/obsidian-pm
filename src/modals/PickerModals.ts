import { SuggestModal, App } from 'obsidian';
import type { Project, Task } from '../types';

export class ProjectPickerModal extends SuggestModal<Project> {
  constructor(
    app: App,
    private projects: Project[],
    private onChoose: (project: Project) => void,
  ) {
    super(app);
    this.setPlaceholder('Pick a project…');
  }

  getSuggestions(query: string): Project[] {
    const q = query.toLowerCase();
    return this.projects.filter(p => p.title.toLowerCase().includes(q));
  }

  renderSuggestion(project: Project, el: HTMLElement): void {
    el.createEl('span', { text: `${project.icon} ${project.title}` });
  }

  onChooseSuggestion(project: Project): void {
    this.onChoose(project);
  }
}

export class TaskPickerModal extends SuggestModal<Task> {
  constructor(
    app: App,
    private tasks: Task[],
    private onChoose: (task: Task) => void,
    placeholder = 'Pick a parent task…',
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getSuggestions(query: string): Task[] {
    const q = query.toLowerCase();
    return this.tasks.filter(t => t.title.toLowerCase().includes(q));
  }

  renderSuggestion(task: Task, el: HTMLElement): void {
    el.createEl('span', { text: task.title });
  }

  onChooseSuggestion(task: Task): void {
    this.onChoose(task);
  }
}

import { describe, expect, it } from 'vitest'
import { hydrateProjectFromFrontmatter, hydrateTaskFromFile } from './YamlHydrator'
import { parseFrontmatter } from './YamlParser'
import { serializeProject, serializeTask } from './YamlSerializer'
import { makeProject, makeTask, type Project, type SavedView, type Task } from '../types'

function roundTripTask(
  t: Task,
  project: Project = makeProject('Test', 'Projects/Test.md'),
  parent: Task | null = null
) {
  const md = serializeTask(t, project, parent)
  const { frontmatter, body } = parseFrontmatter(md)
  if (!frontmatter) throw new Error('frontmatter missing')
  return hydrateTaskFromFile(frontmatter, body, 'Projects/Test_tasks/task.md')
}

function roundTripProject(p: Project) {
  const md = serializeProject(p)
  const { frontmatter, body } = parseFrontmatter(md)
  if (!frontmatter) throw new Error('frontmatter missing')
  return {
    project: hydrateProjectFromFrontmatter(frontmatter, body, p.filePath, 'Test'),
    frontmatter
  }
}

describe('task round-trip', () => {
  it('preserves core scheduling and metadata fields', () => {
    const original = makeTask({
      id: 'task-1',
      title: 'Design API',
      description: 'Draft the endpoints.',
      status: 'in-progress',
      priority: 'high',
      start: '2026-04-01',
      due: '2026-04-10',
      progress: 50,
      assignees: ['Alice', 'Bob'],
      tags: ['api', 'design'],
      dependencies: ['dep-1']
    })
    const { task, subtaskIds, parentId } = roundTripTask(original)

    expect(task.id).toBe(original.id)
    expect(task.title).toBe(original.title)
    expect(task.description).toBe(original.description)
    expect(task.status).toBe(original.status)
    expect(task.priority).toBe(original.priority)
    expect(task.start).toBe(original.start)
    expect(task.due).toBe(original.due)
    expect(task.progress).toBe(original.progress)
    expect(task.assignees).toEqual(original.assignees)
    expect(task.tags).toEqual(original.tags)
    expect(task.dependencies).toEqual(original.dependencies)
    expect(subtaskIds).toEqual([])
    expect(parentId).toBeNull()
  })

  it('records subtaskIds and parentId when present', () => {
    const child = makeTask({ id: 'child-1' })
    const parent = makeTask({ id: 'parent-1', subtasks: [child] })
    const project = makeProject('Test', 'Projects/Test.md')

    const top = roundTripTask(parent, project, null)
    expect(top.subtaskIds).toEqual(['child-1'])
    expect(top.parentId).toBeNull()

    const nested = roundTripTask(child, project, parent)
    expect(nested.subtaskIds).toEqual([])
    expect(nested.parentId).toBe('parent-1')
  })

  it('preserves recurrence, timeEstimate, and timeLogs', () => {
    const original = makeTask({
      id: 'task-2',
      recurrence: { interval: 'weekly', every: 2 },
      timeEstimate: 8,
      timeLogs: [
        { date: '2026-04-01', hours: 2, note: 'setup' },
        { date: '2026-04-02', hours: 3.5, note: 'review' }
      ]
    })
    const { task } = roundTripTask(original)
    expect(task.recurrence).toEqual(original.recurrence)
    expect(task.timeEstimate).toBe(8)
    expect(task.timeLogs).toEqual(original.timeLogs)
  })

  it('preserves a milestone type and empty start', () => {
    const original = makeTask({ id: 'm-1', type: 'milestone', start: '', due: '2026-05-01' })
    const { task } = roundTripTask(original)
    expect(task.type).toBe('milestone')
    expect(task.start).toBe('')
    expect(task.due).toBe('2026-05-01')
  })

  it('preserves custom field values', () => {
    const original = makeTask({
      id: 'task-3',
      customFields: { impact: 'high', score: 42 }
    })
    const { task } = roundTripTask(original)
    expect(task.customFields).toEqual({ impact: 'high', score: 42 })
  })

  it('drops auto-generated Parent wiki-link and Subtasks section from the description', () => {
    const child = makeTask({ id: 'child' })
    const parent = makeTask({ id: 'parent-x', description: 'User-written note.', subtasks: [child] })
    const { task } = roundTripTask(parent)
    expect(task.description).toBe('User-written note.')
  })

  it('defaults missing fields to safe values', () => {
    const frontmatter: Record<string, unknown> = { id: 't-x' }
    const { task } = hydrateTaskFromFile(frontmatter, '', 'path.md')
    expect(task.title).toBe('Untitled')
    expect(task.status).toBe('todo')
    expect(task.priority).toBe('medium')
    expect(task.progress).toBe(0)
    expect(task.assignees).toEqual([])
    expect(task.dependencies).toEqual([])
    expect(task.customFields).toEqual({})
  })
})

describe('project round-trip', () => {
  it('preserves core project fields', () => {
    const p = makeProject('My Project', 'Projects/MyProject.md')
    p.description = 'A great project.'
    p.color = '#ff0000'
    p.icon = '\u{1F680}'
    p.teamMembers = ['Alice', 'Bob']

    const { project } = roundTripProject(p)
    expect(project.title).toBe('My Project')
    expect(project.description).toBe('A great project.')
    expect(project.color).toBe('#ff0000')
    expect(project.icon).toBe('\u{1F680}')
    expect(project.teamMembers).toEqual(['Alice', 'Bob'])
  })

  it('preserves saved views with filter, sortKey, and sortDir', () => {
    const p = makeProject('P', 'Projects/P.md')
    const view: SavedView = {
      id: 'v1',
      name: 'High priority',
      filter: {
        text: 'api',
        statuses: ['in-progress'],
        priorities: ['high', 'critical'],
        assignees: ['Alice'],
        tags: ['design'],
        dueDateFilter: 'overdue',
        showArchived: false
      },
      sortKey: 'due',
      sortDir: 'desc'
    }
    p.savedViews = [view]

    const { project } = roundTripProject(p)
    expect(project.savedViews).toEqual([view])
  })

  it('records taskIds in the frontmatter', () => {
    const p = makeProject('P', 'Projects/P.md')
    p.tasks = [makeTask({ id: 't-1' }), makeTask({ id: 't-2' })]
    const { frontmatter } = roundTripProject(p)
    expect(frontmatter.taskIds).toEqual(['t-1', 't-2'])
  })

  it('falls back to the file basename when title is missing', () => {
    const project = hydrateProjectFromFrontmatter({}, '', 'Projects/Fallback.md', 'Fallback')
    expect(project.title).toBe('Fallback')
    expect(project.id).toBe('Fallback')
  })
})

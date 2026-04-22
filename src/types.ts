import { COLOR_ACCENT } from './constants'
import { today } from './dates'

export type TaskStatus = string
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low'
export type GanttGranularity = 'day' | 'week' | 'month' | 'quarter'
export type GanttWeekLabel = 'weekNumber' | 'dateRange' | 'both'
export type ViewMode = 'table' | 'gantt' | 'kanban'
export type DueDateFilter = 'any' | 'overdue' | 'this-week' | 'this-month' | 'no-date'
export type TaskType = 'task' | 'milestone' | 'subtask'

export interface Recurrence {
  interval: 'daily' | 'weekly' | 'monthly' | 'yearly'
  every: number // e.g. every 2 weeks
  endDate?: string // YYYY-MM-DD
}

export interface TimeLog {
  date: string // YYYY-MM-DD
  hours: number
  note: string
}

export interface CustomFieldDef {
  id: string
  name: string
  type: 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'person' | 'checkbox' | 'url'
  options?: string[] // for select / multiselect
  icon?: string // emoji or lucide icon name
}

export interface Task {
  id: string
  title: string
  description: string
  type: TaskType // 'task' or 'milestone' (zero-duration)
  status: TaskStatus
  priority: TaskPriority
  start: string // YYYY-MM-DD, empty string = unset
  due: string // YYYY-MM-DD, empty string = unset
  progress: number // 0–100
  assignees: string[]
  tags: string[]
  subtasks: Task[]
  dependencies: string[] // task IDs
  recurrence?: Recurrence
  timeEstimate?: number // hours
  timeLogs?: TimeLog[]
  customFields: Record<string, unknown>
  collapsed: boolean
  createdAt: string
  updatedAt: string
  filePath?: string // vault path to this task's .md file
  archived?: boolean // runtime only — derived from file location in Archive/ subfolder
}

export interface Project {
  id: string
  title: string
  description: string
  color: string // hex
  icon: string // emoji
  tasks: Task[]
  customFields: CustomFieldDef[]
  teamMembers: string[]
  createdAt: string
  updatedAt: string
  filePath: string // resolved vault path
  savedViews: SavedView[]
}

export interface FilterState {
  text: string
  statuses: TaskStatus[]
  priorities: TaskPriority[]
  assignees: string[]
  tags: string[]
  dueDateFilter: DueDateFilter
  showArchived: boolean
}

export interface SavedView {
  id: string
  name: string
  filter: FilterState
  sortKey: string
  sortDir: 'asc' | 'desc'
}

export interface StatusConfig {
  id: string
  label: string
  color: string
  icon: string
  complete: boolean
}

export interface PriorityConfig {
  id: TaskPriority
  label: string
  color: string
  icon: string
}

export interface PMSettings {
  projectsFolder: string
  defaultView: ViewMode
  ganttGranularity: GanttGranularity
  ganttWeekLabel: GanttWeekLabel
  statuses: StatusConfig[]
  priorities: PriorityConfig[]
  globalTeamMembers: string[]
  notificationsEnabled: boolean
  notificationLeadDays: number
  autoSchedule: boolean
  ganttHideDone: boolean
  kanbanShowSubtasks: boolean
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_STATUSES: StatusConfig[] = [
  { id: 'todo', label: 'To Do', color: '#8a94a0', icon: '', complete: false },
  { id: 'in-progress', label: 'In Progress', color: '#8b72be', icon: '', complete: false },
  { id: 'blocked', label: 'Blocked', color: '#c47070', icon: '', complete: false },
  { id: 'review', label: 'In Review', color: '#b8a06b', icon: '', complete: false },
  { id: 'done', label: 'Done', color: '#79b58d', icon: '', complete: true },
  { id: 'cancelled', label: 'Cancelled', color: '#767491', icon: '', complete: true }
]

export const DEFAULT_PRIORITIES: PriorityConfig[] = [
  { id: 'critical', label: 'Critical', color: '#c47070', icon: '' },
  { id: 'high', label: 'High', color: '#b8a06b', icon: '' },
  { id: 'medium', label: 'Medium', color: '#8a94a0', icon: '' },
  { id: 'low', label: 'Low', color: '#79b58d', icon: '' }
]

export const DEFAULT_SETTINGS: PMSettings = {
  projectsFolder: 'Projects',
  defaultView: 'table',
  ganttGranularity: 'week',
  ganttWeekLabel: 'weekNumber',
  statuses: DEFAULT_STATUSES,
  priorities: DEFAULT_PRIORITIES,
  globalTeamMembers: [],
  ganttHideDone: false,
  kanbanShowSubtasks: false,
  notificationsEnabled: true,
  notificationLeadDays: 2,
  autoSchedule: true
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString()
  return {
    id: makeId(),
    title: 'New Task',
    description: '',
    type: 'task',
    status: 'todo',
    priority: 'medium',
    start: today().toString(),
    due: '',
    progress: 0,
    assignees: [],
    tags: [],
    subtasks: [],
    dependencies: [],
    customFields: {},
    collapsed: false,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

export function makeProject(title: string, filePath: string): Project {
  const now = new Date().toISOString()
  return {
    id: makeId(),
    title,
    description: '',
    color: COLOR_ACCENT,
    icon: '📋',
    tasks: [],
    customFields: [],
    teamMembers: [],
    createdAt: now,
    updatedAt: now,
    filePath,
    savedViews: []
  }
}

export function makeDefaultFilter(): FilterState {
  return {
    text: '',
    statuses: [],
    priorities: [],
    assignees: [],
    tags: [],
    dueDateFilter: 'any',
    showArchived: false
  }
}

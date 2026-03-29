export type TaskStatus = 'todo' | 'in-progress' | 'blocked' | 'review' | 'done' | 'cancelled';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type GanttGranularity = 'day' | 'week' | 'month' | 'quarter';
export type ViewMode = 'table' | 'gantt' | 'kanban';
export type DueDateFilter = 'any' | 'overdue' | 'this-week' | 'this-month' | 'no-date';
export type TaskType = 'task' | 'milestone' | 'subtask';

export interface Recurrence {
  interval: 'daily' | 'weekly' | 'monthly' | 'yearly';
  every: number;    // e.g. every 2 weeks
  endDate?: string; // YYYY-MM-DD
}

export interface TimeLog {
  date: string;  // YYYY-MM-DD
  hours: number;
  note: string;
}

export interface CustomFieldDef {
  id: string;
  name: string;
  type: 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'person' | 'checkbox' | 'url';
  options?: string[]; // for select / multiselect
  icon?: string;      // emoji or lucide icon name
}

export interface Task {
  id: string;
  title: string;
  description: string;
  type: TaskType;          // 'task' or 'milestone' (zero-duration)
  status: TaskStatus;
  priority: TaskPriority;
  start: string;           // YYYY-MM-DD, empty string = unset
  due: string;             // YYYY-MM-DD, empty string = unset
  progress: number;        // 0–100
  assignees: string[];
  tags: string[];
  subtasks: Task[];
  dependencies: string[];  // task IDs
  recurrence?: Recurrence;
  timeEstimate?: number;   // hours
  timeLogs?: TimeLog[];
  customFields: Record<string, unknown>;
  collapsed: boolean;
  createdAt: string;
  updatedAt: string;
  filePath?: string;   // vault path to this task's .md file
}

export interface Project {
  id: string;
  title: string;
  description: string;
  color: string;   // hex
  icon: string;    // emoji
  tasks: Task[];
  customFields: CustomFieldDef[];
  teamMembers: string[];
  createdAt: string;
  updatedAt: string;
  filePath: string; // resolved vault path
  savedViews: SavedView[];
}

export interface FilterState {
  text: string;
  statuses: TaskStatus[];
  priorities: TaskPriority[];
  assignees: string[];
  tags: string[];
  dueDateFilter: DueDateFilter;
}

export interface SavedView {
  id: string;
  name: string;
  filter: FilterState;
  sortKey: string;
  sortDir: 'asc' | 'desc';
}

export interface StatusConfig {
  id: TaskStatus;
  label: string;
  color: string;
  icon: string;
}

export interface PriorityConfig {
  id: TaskPriority;
  label: string;
  color: string;
  icon: string;
}

export interface PMSettings {
  projectsFolder: string;
  defaultView: ViewMode;
  ganttGranularity: GanttGranularity;
  statuses: StatusConfig[];
  priorities: PriorityConfig[];
  globalTeamMembers: string[];
  notificationsEnabled: boolean;
  notificationLeadDays: number;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_STATUSES: StatusConfig[] = [
  { id: 'todo',        label: 'To Do',       color: '#8a94a0', icon: '○' },
  { id: 'in-progress', label: 'In Progress', color: '#69519a', icon: '◑' },
  { id: 'blocked',     label: 'Blocked',     color: '#b83b3b', icon: '⊘' },
  { id: 'review',      label: 'In Review',   color: '#b8862b', icon: '◎' },
  { id: 'done',        label: 'Done',        color: '#306a48', icon: '●' },
  { id: 'cancelled',   label: 'Cancelled',   color: '#6b7280', icon: '✕' },
];

export const DEFAULT_PRIORITIES: PriorityConfig[] = [
  { id: 'critical', label: 'Critical', color: '#dc2626', icon: '🔴' },
  { id: 'high',     label: 'High',     color: '#ea580c', icon: '🟠' },
  { id: 'medium',   label: 'Medium',   color: '#ca8a04', icon: '🟡' },
  { id: 'low',      label: 'Low',      color: '#16a34a', icon: '🟢' },
];

export const DEFAULT_SETTINGS: PMSettings = {
  projectsFolder: 'Projects',
  defaultView: 'table',
  ganttGranularity: 'week',
  statuses: DEFAULT_STATUSES,
  priorities: DEFAULT_PRIORITIES,
  globalTeamMembers: [],
  notificationsEnabled: true,
  notificationLeadDays: 2,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    id: makeId(),
    title: 'New Task',
    description: '',
    type: 'task',
    status: 'todo',
    priority: 'medium',
    start: new Date().toISOString().slice(0, 10),
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
    ...overrides,
  };
}

export function makeProject(title: string, filePath: string): Project {
  const now = new Date().toISOString();
  return {
    id: makeId(),
    title,
    description: '',
    color: '#69519a',
    icon: '📋',
    tasks: [],
    customFields: [],
    teamMembers: [],
    createdAt: now,
    updatedAt: now,
    filePath,
    savedViews: [],
  };
}

export function makeDefaultFilter(): FilterState {
  return {
    text: '',
    statuses: [],
    priorities: [],
    assignees: [],
    tags: [],
    dueDateFilter: 'any',
  };
}

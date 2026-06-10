export { archiveTask, unarchiveTask } from './ArchiveOps'
export { ProjectStore, TaskFileNameConflictError } from './ProjectStore'
export { computeSchedule, wouldCreateCycle } from './Scheduler'
export {
  applyTaskFilter,
  applyTaskFilterFlat,
  applyTaskFilterPromote,
  countActiveFilters,
  isFilterActive,
  matchesFilter
} from './TaskFilter'
export {
  buildTaskIndex,
  findParentId,
  findTaskById,
  indexAddSubtree,
  indexRemoveSubtree,
  indexSetParent,
  rebuildTaskIndex
} from './TaskIndex'
export type { TaskIndex, TaskIndexEntry } from './TaskIndex'
export {
  addTaskToTree,
  cloneTaskSubtree,
  collectAllAssignees,
  collectAllTags,
  deleteTaskFromTree,
  filterArchived,
  findTask,
  flattenTasks,
  moveTaskInTree,
  totalLoggedHours,
  updateTaskInTree
} from './TaskTreeOps'
export type { FlatTask } from './TaskTreeOps'
export { hydrateTasks } from './YamlHydrator'
export { appendYaml, isOldFormat, parseFrontmatter } from './YamlParser'
export { serializeProject, serializeTask } from './YamlSerializer'

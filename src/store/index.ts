export { ProjectStore } from './ProjectStore'
export { parseFrontmatter, appendYaml, isOldFormat } from './YamlParser'
export { hydrateTasks } from './YamlHydrator'
export { serializeProject, serializeTask } from './YamlSerializer'
export {
  flattenTasks,
  findTask,
  updateTaskInTree,
  deleteTaskFromTree,
  addTaskToTree,
  moveTaskInTree,
  cloneTaskSubtree,
  totalLoggedHours,
  filterArchived,
  filterDone,
  collectAllAssignees,
  collectAllTags
} from './TaskTreeOps'
export type { FlatTask } from './TaskTreeOps'
export { applyTaskFilter, applyTaskFilterFlat, countActiveFilters, isFilterActive, matchesFilter } from './TaskFilter'
export { computeSchedule, wouldCreateCycle } from './Scheduler'
export { archiveTask, unarchiveTask } from './ArchiveOps'

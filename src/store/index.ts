export { archiveTask, unarchiveTask } from './ArchiveOps'
export { ProjectStore, TaskFileNameConflictError } from './ProjectStore'
export type { ImportNoteOptions, TaskSource } from './TaskSource'
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
export { ProjectScope, resolveScopePaths, scopeKey } from './ProjectScope'
export type { ScopeSpec } from './ProjectScope'
export { VaultIndex } from './VaultIndex'
export type { ProjectRef, TaskRef } from './VaultIndex'
export {
  createPersonLink,
  createPersonNote,
  matchPersonNotes,
  personCandidates,
  personKey,
  personKeyer,
  personLink,
  personNotes,
  resolvePeople,
  resolvePerson
} from './people'
export type { PersonCandidate, PersonLinkState, PersonMatch, PersonRef } from './people'
export { projectFolderOf, projectPathForTaskPath, projectTaskFolder, TASK_FOLDER_NAME } from './vaultFs'
export { hydrateTasks } from './YamlHydrator'
export { appendYaml, isOldFormat, parseFrontmatter } from './YamlParser'
export { projectFilePath, serializeProject, serializeTask } from './YamlSerializer'

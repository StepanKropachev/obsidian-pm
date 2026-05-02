# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Quick-add input, search box, filters (status, priority, assignee, tag, due date, archived), and saved views now appear above every view, not just the table
- Filter state persists per project across plugin reloads
- Saved views remember the view mode they were created in; selecting one switches the project to that mode
- Gantt now lifts a matching task to the top level when its parent is filtered out, so search and filters reveal deeply nested matches

### Changed

- UI now follows the Obsidian theme: accent color, near/overdue colors, badge palette, and avatars all read from Obsidian CSS variables instead of the previous hardcoded purple
- Toolbar, gantt, filter, and bulk-action buttons render at native size (previously compact)
- Saved-view tabs share the soft accent treatment with filter pills (previously filled accent)
- `+ save view` and inline chip-list add buttons are native buttons (no longer dashed pills)
- Status and priority badges in the task modal are spans, no longer keyboard-focusable
- Confirm "Delete" uses Obsidian's native warning style
- Light-theme primary buttons use solid accent (`mod-cta`) instead of the bordered variant
- Project view header gear, bulk-action clear, chip remove, and table row icon buttons use lucide icons
- Chip remove buttons turn red on hover, uniformly across tags, assignees, and dependencies
- Project-card and kanban-card progress bars are 3px tall
- The filter row collapses when no filters are active; click the `Filter` pill to expand
- Toggling a filter pill no longer steals focus from the search input
- Gantt milestone labels and dependency arrows now honor the active filter

### Removed

- The gantt "Hide completed" button. Use the Status filter to exclude `Done` and `Cancelled` instead; existing `ganttHideDone: true` settings are migrated automatically into each project's status filter

### Fixed

- Phantom 6px right margin on solo avatars (visible in the project edit modal)
- Kanban cards silently dropping the 4th+ assignee (now shown as `+N`)
- Duplicate task entries when creating a task
- Saved-view pill staying highlighted after the user diverged from its filter

## [1.4.0] - 2026-04-29

### Breaking Changes

- Clicking a project file no longer auto-opens the PM view. Bind the new "Open current file as project" command to a hotkey for the old behavior.

### Added

- Duplicate task action in the table and Kanban context menus
- "Open current file as project" command

### Fixed

- "Today" rolling over in the evening west of UTC
- Tab hijack when clicking a project from a task tab
- Duplicate tabs when opening a project
- Duplicate project list pane from the ribbon button
- Table scroll position not preserved across task modal open/close
- Project folder errors on case-insensitive vaults

## [1.3.2] - 2026-04-21

### Fixed

- `file://` links in task descriptions now open on click

## [1.3.1] - 2026-04-21

### Added

- Redo for Gantt drag actions (Cmd+Shift+Z, Cmd+Y, or the "Redo last action" command)

### Fixed

- Cmd+Z no longer hijacks undo in unrelated notes when a project tab is open

## [1.3.0] - 2026-04-18

### Added

- Custom task statuses, add/remove from settings
- Subtasks as draggable cards on the Kanban board
- Undo for Gantt drag operations (Ctrl/Cmd+Z)
- Interactive checkboxes in task description preview
- "Hide completed tasks" toggle in Gantt
- Bulk set-parent and remove-parent in table view

### Fixed

- Bulk action bar no longer flickers when toggling filters
- Orphaned subtasks reattach to their parent on load
- Orphans get remapped when a custom status is deleted

### Removed

- Emoji placeholder in the custom status icon input

## [1.2.0] - 2026-04-14

### Added

- Import notes as tasks: batch-import vault notes into a project via a multi-file picker
- Click-to-link dependencies on Gantt
- Drag Gantt task bars to reposition them
- Click an empty Gantt row to set start/due dates
- Dependency-based auto-scheduling
- Type `[[` in the description field to link vault notes
- Markdown preview in task descriptions, toggle between edit and rendered
- Shift+click range selection for table checkboxes
- Gantt week labels: week number, date range, or both

### Fixed

- Dependent tasks losing 1 day per reschedule
- Gantt scroll position not preserved on re-render
- Import modal writing tasks to the wrong folder
- Subtasks not rendering when added via the parent task modal
- Crash after deleting dependent tasks
- Task modal scroll jump when typing long descriptions
- Import modal checkbox responsiveness and double-toggle

### Changed

- Dependency picker filters out cycles
- Cross-links to canvases and databases work in task descriptions
- Bulk checkboxes hidden until row hover
- Shift+Enter shortcut hint on task modal buttons

## [1.1.1] - 2026-04-11

No release notes. See the [1.1.0...1.1.1 diff](https://github.com/StepanKropachev/obsidian-pm/compare/1.1.0...1.1.1).

## [1.1.0] - 2026-04-08

First stable release.

### Added

- Gantt: drag-to-reschedule, snap-to-grid, resizable sidebar, milestones, week/month/quarter scales
- Kanban: drag-and-drop board grouped by status
- Table: sort, filter, saved views, inline date editing, quick-add bar
- Task modal: subtasks panel, time tracking, custom fields, auto-save on dismiss
- Bulk actions: multi-select for status changes, deletion, archive/unarchive
- Custom fields per project: text, number, date, checkbox, select, multi-select
- Archive system with a toggle to show archived tasks
- Command palette: create tasks and open projects from anywhere
- Data stored as YAML frontmatter in Markdown files

## [1.0.0-beta] - 2026-03-30

Initial beta.

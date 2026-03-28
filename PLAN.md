# Obsidian-PM: UX Overhaul — Task/Subtask/Project Creation

## Problem Statement
The creation UX is fragmented and unintuitive:
- Creating a subtask via command palette requires 3 modals (ProjectPicker → TaskPicker → TaskModal)
- TaskModal is a 650-line monolith handling tasks, subtasks, milestones, creation, and editing
- Key fields (status, priority, due date) are buried in a collapsed "Properties" section
- Inline subtasks in the modal only support title + checkbox — no priority, dates, assignees
- Quick-add only exists in Table view, not Kanban or Gantt
- No way to convert between task types without opening the full modal
- No keyboard-driven workflow for power users

---

## Phase 1: Streamlined TaskModal — Split Creation vs Editing

### 1.1 — Smart creation mode (minimal form)
**Files:** `src/modals/TaskModal.ts`, `styles.css`

When creating a NEW task, show a **compact creation form** instead of the full edit modal:

```
┌─────────────────────────────────────────┐
│  Task title…                            │
│                                         │
│  ○ To Do  ▼    ◑ Medium ▼    📅 Due ▼  │
│  Parent: (none) ▼                       │
│                                         │
│         [Cancel]  [Create Task]         │
│         [▸ More options]                │
└─────────────────────────────────────────┘
```

- Title input (autofocused)
- Single row of dropdowns: Status, Priority, Due date
- Parent task selector (only if project has tasks; doubles as the subtask mechanism)
- "More options" expands to full modal with description, tags, assignees, etc.
- Enter key creates the task immediately
- Keeps the full modal for editing existing tasks (unchanged)

### 1.2 — Remove the "Type" property selector
**Files:** `src/modals/TaskModal.ts`, `src/types.ts`

The Task/Subtask/Milestone 3-way type toggle is confusing. Instead:
- **Subtask** is determined automatically by whether a Parent is set (parentId != null → subtask)
- **Milestone** becomes a checkbox toggle `☐ Milestone` shown only in the full modal
- Remove the type selector row entirely from the compact creation form
- In full edit mode, show a simple "Milestone" checkbox instead of the 3-way toggle

### 1.3 — Parent task as the primary way to create subtasks
**Files:** `src/modals/TaskModal.ts`

- The "Parent task" dropdown is always visible in creation mode (not hidden in collapsed properties)
- When opened from a context menu "Add subtask" on a task, parent is pre-filled
- Typing in the parent field does fuzzy search (like Obsidian's link autocomplete)
- This eliminates the need for the separate "New Subtask" command with its 3-modal flow

---

## Phase 2: Quick-Add Everywhere

### 2.1 — Universal quick-add bar
**Files:** `src/views/KanbanView.ts`, `src/views/GanttView.ts`, `src/views/ProjectView.ts`, `styles.css`

Add the quick-add input bar (currently only in Table) to:
- **Kanban**: Above the board, same as Table. Created task goes to the leftmost column (todo).
- **Gantt**: In the left sidebar panel, below the task list.
- **Keyboard shortcut**: `n` key (when not in an input) focuses the quick-add input from any view.

### 2.2 — Quick-add with inline modifiers
**Files:** `src/views/TableView.ts` (extend existing), other views

Support inline syntax in quick-add:
- `Buy groceries !high` → sets priority to high
- `Buy groceries @Alice` → assigns to Alice
- `Buy groceries #shopping` → adds tag
- `Buy groceries >2026-04-15` → sets due date
- `Buy groceries /parent:Task Name` → creates as subtask under "Task Name"

Parse modifiers from the input before creating the task. Show a subtle hint below the input: `Tip: !high @name #tag >date`

### 2.3 — Kanban: Quick-add per column
**Files:** `src/views/KanbanView.ts`, `styles.css`

Replace the current "+ Add Task" button at bottom of each Kanban column with an inline text input:
- Click the "+" → transforms into a text input
- Enter creates the task in that column's status
- Escape cancels
- This is much faster than opening a full modal for each card

---

## Phase 3: Context-Aware Creation

### 3.1 — Right-click "Add subtask" opens compact modal with parent pre-set
**Files:** `src/views/TableView.ts`, `src/views/KanbanView.ts`, `src/views/GanttView.ts`

In all views, right-clicking a task and selecting "Add subtask" opens the compact creation modal (Phase 1.1) with the parent pre-filled. No more navigating through the full modal's collapsed properties to find the parent selector.

### 3.2 — Inline subtask creation in Table view
**Files:** `src/views/TableView.ts`, `styles.css`

When a task row is expanded (showing subtasks), add a subtle "+ Add subtask" row at the bottom of the subtask group:
- Clicking it creates an inline editable row (like the quick-add but indented)
- Enter saves, Escape cancels
- Tab moves to next field (status, priority, due) for inline editing

### 3.3 — Remove the "New Subtask" command
**Files:** `src/main.ts`

The 3-modal flow (ProjectPicker → TaskPicker → TaskModal) is replaced by:
- Quick-add with `/parent:TaskName` modifier
- Right-click → "Add subtask" in any view
- Parent dropdown in the compact creation modal
- Delete the `new-subtask` command and `TaskPickerModal` class

### 3.4 — Simplify the "New Task" command
**Files:** `src/main.ts`

If only one project exists, skip the ProjectPicker and go straight to the compact creation modal. Only show the picker when there are multiple projects.

---

## Phase 4: Improved Subtask Experience in TaskModal

### 4.1 — Rich inline subtasks
**Files:** `src/modals/TaskModal.ts`, `styles.css`

Replace the current bare-bones subtask list (title + checkbox + remove) with richer rows:

```
☐ ● Subtask title          Medium ▼   📅 Apr 15   ✕
☑ ● Another subtask        Low ▼      📅 —         ✕
   + Add subtask (Enter)
```

Each subtask row shows:
- Checkbox (status toggle)
- Status dot (colored)
- Editable title
- Priority dropdown (compact)
- Due date (compact picker)
- Remove button

This lets users set the most important fields without opening a separate modal for each subtask.

### 4.2 — Open subtask as full modal
**Files:** `src/modals/TaskModal.ts`

Add a "↗" expand button on each subtask row that opens it in its own full TaskModal. This handles the case where users need to set description, tags, dependencies, etc. on a subtask.

---

## Phase 5: Project Creation Polish

### 5.1 — Simplified project creation
**Files:** `src/modals/ProjectModal.ts`, `styles.css`

Split ProjectModal into two modes like TaskModal:
- **Creation mode**: Title, color, icon only. Team members and custom fields can be added later.
- **Settings mode** (existing behavior when editing): Full form with all fields.

The current modal asks for team members and custom fields upfront, which is overwhelming for a new project.

### 5.2 — Project templates
**Files:** `src/modals/ProjectModal.ts`, `src/types.ts`

Add 3-4 starter templates when creating a project:
- **Blank** (default)
- **Software Project** (pre-configured custom fields: Sprint, Story Points, Component)
- **Content Calendar** (custom fields: Channel, Publish Date, Content Type)
- **Personal** (minimal, no team members section)

Show as selectable cards at the top of the creation modal.

---

## Phase 6: Keyboard & Power User Workflows

### 6.1 — Keyboard shortcuts
**Files:** `src/views/ProjectView.ts`, all view files

| Key | Action |
|-----|--------|
| `n` | Focus quick-add input |
| `Enter` (on selected task) | Open task for editing |
| `Tab` (in quick-add) | Create task & keep focus for next |
| `Escape` | Clear quick-add / close modal |

### 6.2 — Command palette integration
**Files:** `src/main.ts`

- `PM: Quick add task` → Opens compact creation modal (skips project picker if only 1 project)
- `PM: Open project` → Opens project picker → opens project view
- Remove the confusing `PM: Create new subtask` command

---

## Implementation Order

1. **Phase 1** (compact creation modal) — Highest impact, solves the core "mess"
2. **Phase 3.3-3.4** (simplify commands) — Quick cleanup
3. **Phase 2.1** (quick-add everywhere) — Consistency across views
4. **Phase 4.1** (rich subtask rows) — Better subtask workflow
5. **Phase 2.3** (kanban inline add) — Polish
6. **Phase 2.2** (inline modifiers) — Power user feature
7. **Phase 5** (project creation) — Lower priority
8. **Phase 6** (keyboard shortcuts) — Polish

---

## Key Files Summary

| File | Phases |
|------|--------|
| `src/modals/TaskModal.ts` | 1, 4 |
| `src/modals/ProjectModal.ts` | 5 |
| `src/views/TableView.ts` | 2, 3 |
| `src/views/KanbanView.ts` | 2, 3 |
| `src/views/GanttView.ts` | 2, 3 |
| `src/views/ProjectView.ts` | 2, 6 |
| `src/main.ts` | 3, 6 |
| `src/types.ts` | 1 |
| `styles.css` | 1, 2, 3, 4, 5 |

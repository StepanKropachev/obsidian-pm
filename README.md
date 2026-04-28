<div align="center">

# Project Manager for Obsidian
*Full-featured project management, natively in your vault.*

[![Downloads](https://img.shields.io/github/downloads/StepanKropachev/obsidian-pm/total?style=for-the-badge&color=2ea44f)](https://github.com/StepanKropachev/obsidian-pm/releases)
[![Stars](https://img.shields.io/github/stars/StepanKropachev/obsidian-pm?style=for-the-badge&color=007acc)](https://github.com/StepanKropachev/obsidian-pm/stargazers)
[![Support](https://img.shields.io/badge/Donate-Buy%20Me%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/kropachev)

</div>

Table views, Gantt charts, Kanban boards, custom fields, time tracking, smart scheduling — all stored as plain Markdown with YAML frontmatter. No external services. No sync subscriptions. Your data stays yours.

<img width="1422" height="791" alt="Project Manager dashboard" src="https://github.com/user-attachments/assets/ca6bc67f-e656-45be-b93a-17410555ec1a" />

## What's inside

- **Plain-text data** — Projects and tasks live as `.md` files in your vault. Portable, searchable, version-controllable. No lock-in, ever.
- **Three powerful views** — Table, Gantt, and Kanban. Switch freely; same data, different lenses.
- **Real project management** — Not just checkboxes. Dependencies, milestones, subtasks, time tracking, recurring tasks, smart scheduling, bulk actions.
- **Customizable everything** — Custom fields, statuses, priorities, saved views — adapt the tool to your workflow, not the other way around.
- **Works offline** — No cloud, no API calls, no accounts. Just Obsidian.

## Views

### Table

Sortable, filterable task grid with inline editing. Save custom filter/sort combinations as named views. Quick-add tasks from the top bar. Select multiple tasks and apply bulk actions — change status, priority, assignee, or delete in one move.

<video src="https://github.com/user-attachments/assets/104bd993-d4c1-42e7-9d6a-ae46fd7ce6a8" autoplay loop muted playsinline width="400"></video>

### Gantt

Interactive timeline with draggable bars, resizable edges, and dependency arrows. Zoom from day to quarter. Drag to reschedule, resize to adjust duration. Milestones render as diamonds. A "today" line keeps you oriented.

<video src="https://github.com/user-attachments/assets/916f7100-44ef-401c-abb3-e003a0f7720a" autoplay loop muted playsinline width="400"></video>

### Kanban

Card-based board grouped by status. Drag cards between columns to update status instantly. Cards show priority, assignees, and tags at a glance.

<video src="https://github.com/user-attachments/assets/316fc43b-6915-499a-a6ad-0680c462d014" autoplay loop muted playsinline width="400"></video>

## Features

### Task management
- **Subtasks** — Nest tasks to any depth. Collapse/expand hierarchies across all views.
- **Dependencies** — Link blocking/dependent tasks. Visualized as arrows on the Gantt chart.
- **Milestones** — Zero-duration tasks for key dates and deliverables.
- **Archive** — Archive completed tasks without deleting. Toggle visibility at any time.

### Scheduling & time
- **Drag-and-drop scheduling** — Reschedule tasks by dragging bars on the Gantt chart.
- **Smart scheduling** — Auto-adjust dependent task dates when a blocker's dates change. Cycle detection prevents circular dependencies.
- **Recurring tasks** — Daily, weekly, monthly, or yearly recurrence with configurable end dates.
- **Time estimates & logging** — Set estimated hours, log actual time with date and notes. Visual progress bar shows logged vs. estimated.
- **Due date notifications** — Get reminders before tasks are due. Configurable lead time.

### Customization
- **Custom fields** — Add per-project fields: text, number, date, select, multi-select, person, checkbox, URL.
- **Custom statuses & priorities** — Edit labels, colors, and icons for each status and priority level.
- **Saved views** — Save filter/sort combinations in Table view and switch between them instantly.
- **Team roster** — Manage a global team list for assignment across all projects, plus per-project team members.

### Bulk operations
- Multi-select tasks in Table view for batch actions:
  - Set status, priority, assignee, tag, or due date
  - Adjust progress
  - Archive/unarchive
  - Set a parent task
  - Delete

### Import
You can add any existing note from your vault to project as a task. Run **Project Manager: Import notes as tasks** in the Command Palette, pick a project, select files, then choose default status, default priority, and whether to **move** files into the task folder or **copy** them. Already-imported notes are skipped.

https://github.com/user-attachments/assets/64e386c5-09b5-42a6-9599-089cc54c98eb

- If a project view is open, import auto-targets that project (no picker shown).
- If no project view is open, a project picker appears first, then the import modal.

You can also create a project from a note. Add `pm-project: true` to any note's frontmatter, then run **Open current file as project**.


## Collaboration over the Project

The vault is the database. Anything that syncs your vault syncs your projects.

**Git** works well. Commit your projects folder, push, pull. Sync conflicts show up as regular Markdown conflicts. Resolve them like any other file.
**Obsidian Sync, iCloud, Dropbox, Syncthing** all work without extra setup.

For teams:

- Add people in **Settings > Team members**, or to a project's own member list from the project modal.
- Assign tasks via the Assignees field. Filter by assignee in the Table view.
- Notifications are local. Each person sees their own due date reminders.

There is no real-time multi-user editing. Two people editing the same task at once produces a sync conflict, same as any Markdown note.

## Settings

| Setting | Description |
|---|---|
| Projects folder | Vault folder where project and task files are stored |
| Default view | Table, Gantt, or Kanban |
| Gantt granularity | Default timeline scale (day / week / month / quarter) |
| Gantt week labels | Week number, date range, or both |
| Due date notifications | Reminders N days before due dates |
| Notifications on/off | Master switch for due date reminders, separate from lead time |
| Auto-schedule | When a blocking task moves, its dependents shift to match. Cycles are refused. |
| Hide done in Gantt | Skip completed and cancelled tasks on the timeline |
| Show subtasks in Kanban | Render subtasks as their own cards, not just inside the parent |
| Custom statuses | Edit labels, colors, and icons for each status |
| Custom priorities | Edit labels, colors, and icons for each priority |
| Team members | Global roster for task assignment |

## Task properties

Each task is a `.md` file in your vault supporting:

| Property | Description |
|---|---|
| Title | Task name |
| Description | Rich text body (Markdown) |
| Type | Task, Subtask, or Milestone |
| Status | To do, In progress, Blocked, In review, Done, Cancelled |
| Priority | Critical, High, Medium, Low |
| Start / Due date | Schedule boundaries |
| Progress | 0–100% completion |
| Time estimate | Estimated hours |
| Time logs | Logged hours with date and notes |
| Assignees | One or more team members |
| Tags | Freeform labels |
| Subtasks | Nested child tasks |
| Dependencies | Blocking/dependent task links |
| Recurrence | Repeat interval and end date |
| Custom fields | Any per-project fields you define |

## Installation

### Via BRAT (beta releases)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) from the community store.
2. Open BRAT settings > **Add Beta Plugin**.
3. Enter: `https://github.com/StepanKropachev/obsidian-pm`
4. Enable the plugin in **Settings > Community plugins**.

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](../../releases/latest).
2. Create a folder: `<vault>/.obsidian/plugins/project-manager/`
3. Copy the three files into that folder.
4. Reload Obsidian and enable the plugin under **Settings > Community plugins**.

## Quick start

1. Click the dashboard icon in the ribbon (or run **Open projects pane** from the command palette).
2. Click **New project** to create your first project. Give it a name, color, and icon.
3. Open the project — it opens in Table view by default.
4. Press **+ Add task** to create your first task.
5. Switch views using the Table / Gantt / Kanban tabs at the top.

**Commands:**
| Command | What it does |
|---|---|
| Open projects pane | Open the project list |
| Create new project | Open the new project modal |
| Create new task | Pick a project, then create a task |
| Create new subtask | Pick a project and a parent task |
| Import notes as tasks | Convert Markdown notes into tasks |
| Open current file as project | Open the active note as a project (needs `pm-project: true`) |
| Undo last action | Revert the last change |
| Redo last action | Reapply an undone change |

## Data format

Everything is stored as Markdown files with YAML frontmatter in a configurable vault folder (default: `Projects/`). Plain text — readable, portable, and version-controllable.

```yaml
---
pm-task: true
title: "Ship v1.0"
status: in-progress
priority: high
due: "2026-04-01"
progress: 60
assignees: ["alice", "bob"]
tags: ["launch"]
dependencies: ["task-abc123"]
---

Task description in Markdown goes here.
```

## Settings

| Setting | Description |
|---|---|
| Projects folder | Vault folder where project and task files are stored |
| Default view | Table, Gantt, or Kanban |
| Gantt granularity | Default timeline scale (day / week / month / quarter) |
| Gantt week labels | Week number, date range, or both |
| Due date notifications | Reminders N days before due dates |
| Custom statuses | Edit labels, colors, and icons for each status |
| Custom priorities | Edit labels, colors, and icons for each priority |
| Team members | Global roster for task assignment |

## Requirements

- Obsidian **1.4.0** or later
- Desktop and mobile supported

## Contributing

I appreciate community interest in the project! However, since this plugin is maintained by one person in their spare time, I have strict rules to keep the codebase clean, stable, and manageable. 

If you want to contribute, please follow these rules:

1. **Open an Issue first:** Do not submit a Pull Request for new features, architecture changes, or major refactoring without discussing it in an issue first. Uncoordinated PRs will be closed.
2. **No AI-generated bulk code:** I do not accept massive, AI-generated PRs. Code must be human-readable, minimalistic, and match the existing project style.
3. **Pass the CI:** Make sure your code passes all strict type checks, linters, and tests. Run `pnpm check`, `pnpm check:submission`, and `pnpm test` locally before pushing.
4. **Keep it small:** PRs should be strictly focused on a single issue. 

Bug fixes and thoroughly discussed features are always welcome!

## License

MIT

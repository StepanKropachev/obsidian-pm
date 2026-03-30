# Project Manager for Obsidian

**Full-featured project management, natively in your vault.**

Table views, Gantt charts, Kanban boards — all stored as plain Markdown with YAML frontmatter. No external services. No sync subscriptions. Your data stays yours.

---

## Views

**Table** — Sortable, filterable task grid with inline editing. Save custom filter/sort combinations as named views. Add subtasks inline from any row.

**Gantt** — Timeline view with draggable bars, dependency visualization, and configurable granularity (day / week / month / quarter). See the full project at a glance.

**Kanban** — Card-based board grouped by status. Drag cards between columns to update status in one move.

---

## What you can track

Each task supports: title, description, status, priority, start date, due date, progress (0–100%), time estimate, time logs, assignees, tags, subtasks, dependencies, and recurrence rules.

Projects support custom fields (text, number, date, select, multi-select, checkbox, URL, person), a shared team roster, and saved views per project.

**Statuses:** `todo` · `in-progress` · `blocked` · `review` · `done` · `cancelled`
**Priorities:** `critical` · `high` · `medium` · `low`

---

## Installation

### Via BRAT (recommended for early access)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) from the Obsidian community store.
2. Open BRAT settings → **Add Beta Plugin**.
3. Enter: `StepanKropachev/obsidian-project-manager`
4. Enable the plugin in **Settings → Community plugins**.

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](../../releases/latest).
2. Create a folder: `<vault>/.obsidian/plugins/project-manager/`
3. Copy the three files into that folder.
4. Reload Obsidian and enable the plugin under **Settings → Community plugins**.

---

## Quick start

1. Click the dashboard icon in the ribbon (or run **Open Projects pane** from the command palette).
2. Click **New project** to create your first project. Give it a name, color, and optional icon.
3. Open the project — it opens in Table view by default.
4. Press **+ Add task** to create your first task.
5. Switch views using the Table / Gantt / Kanban tabs at the top.

**Commands available:**
- `Open Projects pane`
- `Create new project`
- `Create new task`
- `Create new subtask`

---

## Data format

Projects and tasks are stored as Markdown files with YAML frontmatter in a configurable vault folder (default: `Projects/`). They're plain text — readable, portable, and version-controllable.

```yaml
---
pm-task: true
title: "Ship v1.0"
status: in-progress
priority: high
due: "2026-04-01"
progress: 60
---
```

---

## Settings

| Setting | Description |
|---|---|
| Projects folder | Vault folder where project files are stored |
| Default view | Table, Gantt, or Kanban |
| Gantt granularity | Default timeline scale |
| Due date notifications | Get reminders N days before due dates |
| Team members | Global roster for task assignment |

---

## Requirements

- Obsidian **1.4.0** or later
- Desktop or mobile (no desktop-only APIs used)

---

## License

MIT © Stepan Kropachev

# UI styleguide (component catalog)

Read this before building or changing any UI. It's the component API catalog: what exists and what to reach for. The design language (color, typography, spacing, radii, shadows, voice) lives in `docs/design-system.md`. The layer rules (primitives / composites / orchestrators and what each may import) live in CLAUDE.md under "UI layers".

Verify appearance in the live gallery (see "Live gallery" below), never in an offline HTML page: without Obsidian's core `app.css` the controls misrender.

## Decision tree

Before writing any new UI element, find your case here:

- Need a small label, badge, or token (status, priority, tag, due date, count) -> `Chip`
- Need a text button -> Obsidian `ButtonComponent`
- Need an icon-only button -> `IconButton`
- Need a compact button, toggleable or not -> `ChipButton`
- Need a remove/x button on a token -> `Chip.setRemovable`
- Need an "+ add" ghost row or button -> `renderAddButton`
- Need mutually-exclusive options -> `SegmentedControl` (text) or `ViewSwitcher` (icons)
- Need a floating panel with inputs -> `Popover` (never hand-rolled absolute positioning)
- Need a flat action list at the cursor -> Obsidian `Menu`
- Need a status or priority indicator -> `renderStatusBadge` / `renderPriorityBadge` / `renderStatusDot`
- Need a logged/estimate hours chip -> `renderTimeChip`
- Need a due-date chip with urgency colors -> `renderDueChip`
- Need to say which project something belongs to -> `renderProjectChip`
- Need a link to a note (a task, a person) -> `renderNoteLink`
- Need user initials -> `Avatar` / `AvatarStack`
- Need a progress indicator -> `ProgressBar`
- Need an empty placeholder -> `EmptyState`
- Need a boolean the user flips -> `Checkbox`
- Need to pick an icon or emoji -> `renderIconControl`
- Need a label + value form row -> `renderPropRow`
- Need a removable-token list -> `renderMultiSelect`
- Need to pick one or more people -> `renderPersonPicker`
- Need a row of headline numbers -> `renderMetricStrip`
- Need dated points on one track -> `renderMilestoneTimeline`

Nothing fits? Extend an existing primitive with a new setter or variant instead of adding a new class or one-off element. Adding a brand-new primitive requires updating this file and `src/views/styleguide/StyleguideView.ts` in the same change.

## Primitives (`src/ui/primitives/`)

Chained-setter API modeled on Obsidian's `ButtonComponent`. Constructor takes `parentEl`; the root element is exposed as `.el`. Primitives import nothing from `store/` or `main`.

### Chip - `Chip.ts`

The unified label primitive: status, priority, tags, due dates, time, small badges.

- API: `new Chip(parent).setLabel(text).setVariant('solid'|'outline'|'plain').setColor(cssColor).setDot(bool).setLeadingIcon(lucide).setTag(bool).setStrong(bool).setShape('rounded'|'pill').setSize('md'|'sm').setTooltip(text).setRemovable(onRemove).onClick(handler)`
- CSS: `pm-chip` + `--solid/--outline/--plain/--tag/--strong/--pill/--sm/--interactive`, parts `pm-chip-label/-icon/-dot/-rm`; color flows through `--pm-chip-color`
- Use when: any small labeled token, clickable or not (`onClick` adds hover/click styling)
- Not when: a real button (`ChipButton` when compact, `ButtonComponent` otherwise)

### ChipButton - `ChipButton.ts`

The button sibling of `Chip`: a compact native button with an optional persistent active state. Wraps Obsidian's `ButtonComponent`; active carries the plugin's 12% accent-tint selection signature. Used by saved views, filter dropdowns, due/archived toggles, and the filter row's Clear.

- API: `new ChipButton(parent).setLabel(text).setActive(bool).setShape('rounded'|'pill').setAriaLabel(text).onClick(h).onContextMenu(h)`
- CSS: `button.pm-chip-btn` (the `button` prefix outranks core button chrome), `--active`, `--pill`
- Use when: a compact button among chips/capsules, with or without persistent state
- Not when: a non-interactive label (`Chip`) or a standalone full-size action button (`ButtonComponent`)

### Avatar / AvatarStack - `Avatar.ts`, `AvatarStack.ts`

Initials disc for a person; the stack renders several with a `+N` overflow badge.

- API: `new Avatar(parent).setName(raw).setSize('md'|'sm').setUnresolved(bool).onClick(fn)`; `new AvatarStack(parent).setPeople(AvatarPerson[]).setMax(n).setSize('md'|'sm')`, or `setNames(string[])` for people with no note behind them
- `AvatarPerson` is `{ name, unresolved?, onClick? }`. Orchestrators build it with `linkedRefs(app, values, sourcePath)` (`src/views/linkedRefs.ts`), which resolves each stored value and opens the note behind it on click. It is the one resolver for stored values that name a note: assignees, members, and person custom fields all go through it
- `displayName(raw)` (exported from `utils.ts`) resolves `[[wikilink|alias]]` names; `setName` applies it automatically
- CSS: `pm-avatar`, `--sm`, `--more`, `--link`, `--unresolved`; `pm-avatar-stack`; background from `stringToColor`
- Use when: any assignee/member display
- Not when: you need the raw name as text (use `displayName` yourself)

### IconButton - `IconButton.ts`

Icon-only button; wraps Obsidian's `ExtraButtonComponent`.

- API: `new IconButton(parent).setIcon(lucide).setTooltip(text).setRevealOnHover(bool).onClick(h)`
- CSS: `pm-icon-btn`, `--hover-only`
- Use when: row actions, delete/remove buttons, hover-revealed actions
- Not when: the button carries a text label (`ButtonComponent`)

### ProgressBar - `ProgressBar.ts`

Horizontal progress track with optional percent label.

- API: `new ProgressBar(parent).setValue(0-100).setColor(cssColor).setSize('sm'|'md').setShowLabel(bool)`
- CSS: `pm-progress`, `-track`, `-fill`, `-label`, `--sm`; color via `--pm-progress-color`
- Use when: task/project completion display
- Editable progress: swap the display for a number input on click via `makeInlineEdit` (ProgressCell keeps the bar as display; the task editor's Progress row uses `renderInputControl`)

### CollapseToggle - `CollapseToggle.ts`

Obsidian-native collapse triangle for tree rows.

- API: `new CollapseToggle(parent, { collapsed, onToggle, subject? })` (constructor-only); `subject` names what collapses in the aria label, defaulting to subtasks
- CSS: `tree-item-icon collapse-icon pm-collapse-toggle`, `is-collapsed`
- Use when: expanding/collapsing subtask trees, or sub-projects in the project list

### Checkbox - `Checkbox.ts`

Obsidian's native checkbox, for anything stored as a plain boolean. Backs the subtask done boxes and `checkbox` custom fields.

- API: `new Checkbox(parent).setChecked(bool).setAriaLabel(text).onChange(checked => ...)`; `.el` is the `input`
- CSS: `pm-checkbox` (alignment only - core paints the box)
- Use when: a boolean the user flips directly
- Not when: the value is a choice among options (`renderSelectControl`) or a filter toggle among chips (`ChipButton`)

### EmptyState - `EmptyState.ts`

Quiet empty placeholder: small icon, one line of muted text, optional CTA.

- API: `new EmptyState(parent).setIcon(text).setTitle(text).setBody(text).setAction(label, onClick)`
- CSS: `pm-empty-state`, `pm-empty-icon`, `pm-empty-action`; the action is a native CTA `ButtonComponent`
- Use when: a view or list has nothing to show

### SegmentedControl - `SegmentedControl.ts`

Mutually-exclusive text options (e.g. the Task / Subtask / Milestone type picker).

- API: `new SegmentedControl(parent, { options: [{id, label}], active, onChange })`
- CSS: `pm-segmented` (layout only); the buttons are native `ButtonComponent`s, active gets `setCta()`

### ViewSwitcher - `ViewSwitcher.ts`

Mutually-exclusive icon options (the Table / Gantt / Kanban switcher).

- API: `new ViewSwitcher(parent, { options: [{id, icon, label}], active, onChange })`
- CSS: `pm-view-switcher`, `pm-view-btn`, `--active`

### Popover - `Popover.ts`

Floating panel anchored to a trigger, for content Obsidian's `Menu` can't host (date inputs, search fields). Renders as a bottom sheet on phones; handles outside-click, Escape, scroll/resize repositioning, and modal focus-trap quirks. Read its JSDoc before use.

- API: `new Popover({ anchor, host?, align?: 'left'|'right', width?, onClose? })`; fill `.contentEl`, then `open()` / `close()`; `isOpen` getter
- CSS: `pm-pop`, `pm-pop-body`, `--sheet`; position via `--pop-top/--pop-left/--pop-width`
- Use when: an anchored panel needs focusable inputs
- Not when: a flat list of actions suffices (Obsidian `Menu`)

## Composites (`src/ui/composites/`)

Take resolved data + callbacks via props. No `plugin`, no `store`, no `onRefresh`. If a composite needs `plugin`, it's the wrong shape; push the store access up to the orchestrator view.

- **KanbanCard** - `KanbanCard.ts`. Props: task, priorityColor, descriptionPreview, parentTitle, renderSource, loggedHours, overdue, showTagColors + onClick/onContextMenu/onDragStart/onDragEnd. Composes Chip (milestone/subtask/recurring badges), renderTimeChip, renderDueChip, AvatarStack, ProgressBar (task progress), renderTagChip. It knows nothing about projects: `renderSource` is a slot the board fills, with `renderProjectChip`, when a card has to say where it is from.
- **KanbanColumn** - `KanbanColumn.ts`. Props: status, cards + drag/drop and card callbacks. Composes KanbanCard.
- **ProjectRow** - `ProjectRow.ts`. Props: title, icon, color, depth, treeGuides, isLastChild, childCount, collapsed, tasksDone, tasksTotal, overdue, members, dueLabel, dueUrgency + onToggleCollapsed/onClick/onContextMenu/onActions. One `<tr>` of the project list, built on the same `pm-table` chrome and cell classes as the task table: CollapseToggle when it has sub-projects, ProgressBar, a red overdue Chip, AvatarStack, renderDueChip, and a hover-revealed IconButton. Indents from `--depth` and draws sub-project connectors from `treeGuides` + `isLastChild`, exactly as TitleCell does; the caller reads `settings.showSubtreeConnections` to decide and stamps `settings.lineBorders` on the wrapper as `data-borders`. With sub-projects the counts are the caller's rollup over the subtree.
- **TaskRow** - `TaskRow.ts`. Props: taskId, depth, isDone, isArchived, isSelected, onRowClick. Bare `<tr>` with row-click routing that ignores interactive descendants; cells render into it.
- **addButton** - `addButton.ts`. `renderAddButton(parent, label, onClick)` -> ghost "+ label" button (`pm-prop-add`). The only way to render an add button.
- **tagChip** - `tagChip.ts`. `renderTagChip(parent, tag, colored)` -> outline tag Chip with optional color dot. The only way to render a tag.
- **timeChip** - `timeChip.ts`. `renderTimeChip(parent, logged, estimate, size?)` -> `logged/estimateh` Chip, red solid when logged exceeds the estimate; renders nothing when both are 0. The only way to render logged/estimate hours.
- **projectChip** - `projectChip.ts`. `renderProjectChip(parent, { title, color, onClick? })` -> dot-led outline Chip naming a project; with `onClick` it gets a tooltip and stops the click reaching the row or card under it. The only way to render a project token, used by the table's ProjectCell, the board's cards, and the timeline's labels.
- **noteLink** - `noteLink.ts`. `renderNoteLink(parent, { label, path, open, cls? })` -> an `a.pm-note-link.internal-link` carrying the note in `data-href` and nothing in `href`, so click and Enter/Space both run `open` (through `makeActivatable`, see below). The dependency rows and the task editor's subtasks use it; `cls` carries the caller's own layout class. The only way to render a link to a note.
- **dueChip** - `dueChip.ts`. `renderDueChip(parent, label, urgency, size?)` -> due-date Chip, orange when `urgency` is `'near'`, red solid when `'overdue'`. Caller formats the label (`formatDateLong` / `formatDateShort`). The only way to render a due date.
- **metricStrip** - `metricStrip.ts`. `renderMetricStrip(parent, stats)` -> bordered row of `{ label, value, sub?, extra?, alert? }` cells; `extra` composes a bar or chip beside the value, `alert` colors it red. The project overview's stats row.
- **milestoneTimeline** - `milestoneTimeline.ts`. `renderMilestoneTimeline(parent, points, todayPos)` -> one track with date-proportional dots (`done` / `next` / `plan`) and a dashed today marker. The caller converts dates to 0-100 positions; labels closer than one label-width drop to a second row, and the track scrolls horizontally once it holds more milestones than fit.
- **ProjectHeader** - `ProjectHeader/`. Props: tasks (every task in scope, for the assignee and tag options), savedViews, statuses, priorities, filter, activeSavedViewId + callbacks; methods `refresh`, `notifyMutation`, `setActiveSavedViewId`. Composes PrimaryRow (saved-view ChipButtons, save button) and FilterRow (filter dropdowns, due/archived ChipButtons).
- **Cells** - `cells/`. One `<td>` builder per column: StatusCell, PriorityCell, ProjectCell, TitleCell, DueDateCell, TimeCell, ProgressCell, AssigneesCell, ExpandCell, ActionsCell, SelectCell, CustomFieldCell. ProjectCell (a `renderProjectChip` in a `<td>`) is rendered only when the view covers several projects. `inlineEdit.ts` (`makeInlineEdit`) is the shared inline text/date/number editor. Adding a table column means adding a cell here, not inline DOM in the renderer.
  - **CustomFieldCell** takes one `CustomFieldValue`: `{ kind: 'text' }`, `{ kind: 'checkbox' }` (a check glyph, `—` when false), `{ kind: 'url' }` (an `a.external-link`), `{ kind: 'people' }` (an AvatarStack, the same avatars AssigneesCell shows), or `{ kind: 'links' }` (note names as `pm-cf-link`, joined with commas). People and links are both `AvatarPerson[]` from `linkedRefs`, so a person field and an assignee resolve and open the same way.
  - **TitleCell** keeps the `<td>` a real table cell and puts the title, badges, and tags in a `.pm-table-title-inner` flex row, so a row made taller by another column still centers them (`ProjectRow` does the same). It indents from `--depth` on the parent `TaskRow` (CSS, not an inline style) and draws subtask tree connectors through `renderTreeGuides` (`composites/treeGuides.ts`, shared with `ProjectRow`) from `treeGuides` + `isLastChild`: one `.pm-tree-guide` span per indent column, the deepest carrying `--elbow`. Pass `treeGuides: null` to indent without lines. The caller reads `config.showSubtreeConnections` to decide.
  - The grid is off by default. `TableRenderer` stamps `config.lineBorders` onto the wrapper as `data-borders`, re-applied on every body fill so a settings change lands without rebuilding the table; cells carry no rules of their own.
- **Property controls** - `properties/` (barrel `index.ts`): `renderSelectControl` (single-choice popover: status, priority, type, repeat, parent), `renderMultiSelect` (multi-choice: tags, people, dependencies; `moreOptions(query)` adds a second searched tier under a `moreHeading`, and `createAlt` adds a second create row whose async `run` is awaited before the list repaints - `renderPersonPicker` uses both to offer vault person notes and to create one; `keyOf(id)` is the identity a selected value is matched by, so a person written as a name and as a link is one row rather than two; in `depsList` mode `linkFor(id)` gives back the note a value stands for and how to open it), `renderDepRow` (one task in a dependency list: link icon, task id, title, and a remove button when `onRemove` is passed; with a `link` the title is a `renderNoteLink`, which the task editor points at `openTaskByPath` so a dependency leads to that task's editor rather than the markdown behind it. The deps-list mode of `renderMultiSelect` builds its rows from it, and the task editor's read-only Blocks list calls it directly, so both read the same), `renderDateControl` (date popover; renders a `.pm-due` hint span only when the caller passes `hint` - a relative due-state on Due, a muted on-time/late outcome on Completed, nothing on Start), `renderInputControl` (click-to-edit text, number, or date with an optional display `suffix`; the `number` option rounds and clamps to `min`/`max` and is read only when `inputType` is `'number'`: Progress), `renderIconControl` (icon preview that opens a searchable grid of every icon Obsidian knows; a query that isn't a plain icon name is offered as a literal glyph, which is how emoji are picked, and "No icon" clears it - backs the status and priority icon fields, the new project dialog, and the project edit page), `renderAddProperty` (progressive-disclosure "Add property" built on `renderAddButton`), `optionList.ts` helpers (`renderGlyph`, `renderOptionRow`). `src/modals/TaskFormFields.ts` shows the intended composition of these with `renderPropRow`. A project's custom fields go through the same controls (`src/modals/CustomFieldInputs.ts`), one per field type, so a custom date behaves like Due and a custom select like Status; a `checkbox` field is the `Checkbox` primitive, the one type with no property control of its own.

## Shared widgets (`src/ui/*.ts`)

Richer than primitives, used across views. Avoid expanding this bucket; prefer composites/primitives when they fit.

- **FilterDropdown** - `renderFilterDropdown(parent, label, selected, options, onChange)`: a ChipButton that opens a checkable Menu with a Clear item. Any multi-select filter control.
- **FormField** - `renderPropRow(container, label, valueBuilder, icon?)`: the label + value form row every property grid is built from.
- **StatusBadge** - `renderStatusBadge(container, task, statuses, onChange)` (solid dot-led Chip + picker Menu), `renderPriorityBadge(container, task, priorities, iconSet, onChange)` (plain Chip with a rank icon + picker Menu; the icon comes from `priorityIcon(priorities, id, iconSet)` in `src/utils.ts`, which picks from `PRIORITY_ICON_SETS`), `renderStatusDot(container, status, statuses, cls?)` (bare colored dot). The only way to render status/priority.
- **TaskContextMenu** - `buildTaskContextMenu(menu, task, ctx)`: the task right-click menu.
- **makeActivatable** - `makeActivatable(el, open)` in `src/utils.ts`. Gives a span, div, or bare `<a>` the behavior a link needs: `role` and `tabindex`, then click and Enter/Space both running `open` without reaching the row or card behind it. `renderNoteLink`, `Avatar.onClick`, and CustomFieldCell's link names all go through it. Reach for a real `<button>` first; this is for the cases where the markup can't be one.
- **ModalFactory** - all modal opening: `openTaskModal`, `openTaskByPath` (the same editor for a task addressed by its note path, loading the project it belongs to; what a link to a task opens), `openProjectCreate`, `openProjectPicker`, `openTaskPicker`, `openPersonLookup` (the people already assigned somewhere, for the command that shows one person's tasks - a lookup, not a way to set a value), `openImportModal`, `confirmDialog`, `confirmDuplicateSubtasks`, `promptText`. Never instantiate a modal directly from a view. A new project is asked for in a dialog (`openProjectCreate`); an existing one is edited on a page of its own (`plugin.router.openProjectEdit`).
- **PersonPicker** - `renderPersonPicker({ container, plugin, sourcePath, extra?, addLabel, selected, add, remove })`: the only control for picking people, behind task assignees, person custom fields, project members, the new project dialog, and the global team members in settings. A `renderMultiSelect` in `avatarStack` mode whose two tiers come from `peopleSource(plugin, sourcePath, extra?)` - `known()` (the global members plus whatever the caller passes, deduped by `personKey`) and `search(query)` (person notes) - plus rows to add a typed name as plain text or create the note for it. `sourcePath` is the note the value is written into, so the link resolves from there; pass `''` when there is no note yet. `peopleSource` is exported on its own for the bulk bar's assignee menu, so every surface offers the same people.
- **PaletteListEditor** - `renderPaletteFields(parent, item, onChanged)` (icon picker + label + color inputs) and `renderStatusDoneToggle` are the row internals, used by the plugin settings pages. `renderStatusListEditor` / `renderPriorityListEditor` wrap them with their own drag handle and delete button for the project edit page's per-project overrides; plugin settings get those affordances from Obsidian's list settings instead. Plus `wireRowDragReorder`.

## Native Obsidian components to use directly

No wrappers for these:

- `ButtonComponent` - any text button (`.setButtonText().setCta().onClick()`)
- `ExtraButtonComponent` - icon button when `IconButton`'s extras are not needed
- `Setting` - settings rows and section headings (`.setName().setHeading()`)
- `Menu` - context menus and flat pickers (`.addItem()`, `.showAtMouseEvent()`)
- `SuggestModal` / `FuzzySuggestModal` - searchable pickers (via ModalFactory)
- `setIcon(el, 'lucide-name')` - icons; size via `--icon-size` on the parent (width/height rules do not override `.svg-icon`)

## Live gallery

A dev-only view renders every primitive and key composite in all variants: `src/views/styleguide/StyleguideView.ts`, command "Open styleguide gallery".

- The view is compiled in only when `__STYLEGUIDE__` is true: dev builds (`pnpm dev`) always include it; production builds exclude it unless `STYLEGUIDE=1` is set.
- The `/live-dev` deploy builds with `PRODUCTION=1`, so use `STYLEGUIDE=1 .claude/skills/live-dev/deploy.sh` or the gallery will be missing from the deployed build.
- To open and screenshot it over CDP (see `docs/live-inspection.md`):

```
uv run scripts/cdp.py eval 'app.commands.executeCommandById("project-manager:open-styleguide")'
uv run scripts/cdp.py eval 'document.querySelector("[data-sg=chip]").scrollIntoView()'
uv run scripts/cdp.py shot styleguide-chip.png
```

Each section has a `data-sg` attribute (`chip`, `chip-button`, `avatar`, `icon-button`, `progress`, `collapse`, `checkbox`, `empty-state`, `segmented`, `view-switcher`, `popover`, `badges`, `form`, `time-due`, `project-row`, `cards`, `metric-strip`, `milestone-timeline`, `table`).

## Maintenance

- Adding or changing a component: update its entry here and its section in `StyleguideView.ts` in the same change.
- Removing a component: delete its entry and gallery section, and check `src/styles/` for now-orphaned classes.
- Consolidating a deprecated pattern: remove its row from the table above and close the todo.

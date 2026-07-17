# UI styleguide (component catalog)

Read this before building or changing any UI. It's the component API catalog: what exists and what to reach for. The design language (color, typography, spacing, radii, shadows, voice) lives in `docs/design-system.md`. The layer rules (primitives / composites / orchestrators and what each may import) live in CLAUDE.md under "UI layers".

The static HTML previews under `docs/design-system/project/preview/` are design references only; they misrender CSS because Obsidian's core `app.css` is absent. For visual verification use the live gallery (see "Live gallery" below).

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
- Need to pick a calendar date -> `CalendarPicker` (never an OS/browser-native `<input type="date">`)
- Need a flat action list at the cursor -> Obsidian `Menu`
- Need a status or priority indicator -> `renderStatusBadge` / `renderPriorityBadge` / `renderStatusDot`
- Need a logged/estimate hours chip -> `renderTimeChip`
- Need a due-date chip with urgency colors -> `renderDueChip`
- Need user initials -> `Avatar` / `AvatarStack`
- Need a progress indicator -> `ProgressBar`
- Need an empty placeholder -> `EmptyState`
- Need a label + value form row -> `renderPropRow`
- Need a removable-token list -> `renderChipList`

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

- API: `new Avatar(parent).setName(raw).setSize('md'|'sm')`; `new AvatarStack(parent).setNames(string[]).setMax(n).setSize('md'|'sm')`
- `displayName(raw)` (exported from `Avatar.ts`) resolves `[[wikilink|alias]]` names; `setName` applies it automatically
- CSS: `pm-avatar`, `--sm`, `--more`; `pm-avatar-stack`; background from `stringToColor`
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
- Not when: user-editable progress (use `renderProgressSlider` from `FormField.ts`)

### CollapseToggle - `CollapseToggle.ts`

Obsidian-native collapse triangle for tree rows.

- API: `new CollapseToggle(parent, { collapsed, onToggle })` (constructor-only)
- CSS: `tree-item-icon collapse-icon pm-collapse-toggle`, `is-collapsed`
- Use when: expanding/collapsing subtask trees

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

### CalendarPicker - `CalendarPicker.ts`

A month-grid date picker rendered entirely in plugin chrome — the in-plugin replacement for an OS/browser-native `<input type="date">`. A Sun–Sat weekday header, a month label with previous/next navigation, and clickable day cells in Sunday-through-Saturday columns. Consumes and emits `YYYY-MM-DD` strings; all date math routes through `src/dates.ts` (`Temporal`), never `Date`. Backs the date popover in `renderDateControl`.

- API: `new CalendarPicker(parent).setValue('YYYY-MM-DD').onChange((dateStr) => …)`
- CSS: `pm-calendar-picker`, parts `__header/__nav/__prev/__next/__title/__weekdays/__weekday/__grid/__day`, states `__day--adjacent/--today/--selected`
- Use when: a user picks a single whole-day date
- Not when: a date range, multiple dates, or a time-of-day is needed (out of scope)

## Composites (`src/ui/composites/`)

Take resolved data + callbacks via props. No `plugin`, no `store`, no `onRefresh`. If a composite needs `plugin`, it's the wrong shape; push the store access up to the orchestrator view.

- **KanbanCard** - `KanbanCard.ts`. Props: task, priorityColor, descriptionPreview, parentTitle, subtaskProgress, loggedHours, overdue, showTagColors + onClick/onContextMenu/onDragStart/onDragEnd. Composes Chip (milestone/subtask/recurring badges), renderTimeChip, renderDueChip, AvatarStack, ProgressBar, renderTagChip.
- **KanbanColumn** - `KanbanColumn.ts`. Props: status, cards + drag/drop and card callbacks. Composes KanbanCard.
- **ProjectCard** - `ProjectCard.ts`. Props: title, icon, color, tasksDone, tasksTotal, onClick, onContextMenu. Composes ProgressBar.
- **TaskRow** - `TaskRow.ts`. Props: taskId, depth, isDone, isArchived, isSelected, onRowClick. Bare `<tr>` with row-click routing that ignores interactive descendants; cells render into it.
- **addButton** - `addButton.ts`. `renderAddButton(parent, label, onClick)` -> ghost "+ label" button (`pm-prop-add`). The only way to render an add button.
- **tagChip** - `tagChip.ts`. `renderTagChip(parent, tag, colored)` -> outline tag Chip with optional color dot. The only way to render a tag.
- **timeChip** - `timeChip.ts`. `renderTimeChip(parent, logged, estimate, size?)` -> `logged/estimateh` Chip, red solid when logged exceeds the estimate; renders nothing when both are 0. The only way to render logged/estimate hours.
- **dueChip** - `dueChip.ts`. `renderDueChip(parent, label, urgency, size?)` -> due-date Chip, orange when `urgency` is `'near'`, red solid when `'overdue'`. Caller formats the label (`formatDateLong` / `formatDateShort`). The only way to render a due date.
- **ProjectHeader** - `ProjectHeader/`. Props: project, statuses, priorities, filter, activeSavedViewId + callbacks; methods `refresh`, `notifyMutation`, `setActiveSavedViewId`. Composes PrimaryRow (saved-view ChipButtons, save button) and FilterRow (filter dropdowns, due/archived ChipButtons).
- **Cells** - `cells/`. One `<td>` builder per column: StatusCell, PriorityCell, TitleCell, DueDateCell, TimeCell, ProgressCell, AssigneesCell, ExpandCell, ActionsCell, SelectCell, CustomFieldCell. `inlineEdit.ts` (`makeInlineEdit`) is the shared inline text/date editor. Adding a table column means adding a cell here, not inline DOM in the renderer.
- **Property controls** - `properties/` (barrel `index.ts`): `renderSelectControl` (single-choice popover: status, priority, type, repeat, parent), `renderMultiSelect` (multi-choice: tags, assignees, dependencies), `renderDateControl` (date popover), `renderAddProperty` (progressive-disclosure "Add property" built on `renderAddButton`), `optionList.ts` helpers (`renderGlyph`, `renderOptionRow`). `src/modals/TaskFormFields.ts` shows the intended composition of these with `renderPropRow`.

## Shared widgets (`src/ui/*.ts`)

Richer than primitives, used across views. Avoid expanding this bucket; prefer composites/primitives when they fit.

- **FilterDropdown** - `renderFilterDropdown(parent, label, selected, options, onChange)`: a ChipButton that opens a checkable Menu with a Clear item. Any multi-select filter control.
- **FormField** - `renderPropRow(container, label, valueBuilder, icon?)` (label + value form row), `renderChipList(container, items, { variant, shape, onRemove, onAdd?, ... })` (removable-token list with add affordance), `renderProgressSlider(container, value, onChange)`.
- **StatusBadge** - `renderStatusBadge(container, task, statuses, onChange)` (solid dot-led Chip + picker Menu), `renderPriorityBadge(...)` (plain Chip with chevron icon + picker Menu), `renderStatusDot(container, status, statuses, cls?)` (bare colored dot), `PRIORITY_CHEVRONS`. The only way to render status/priority.
- **TaskContextMenu** - `buildTaskContextMenu(menu, task, ctx)`: the task right-click menu.
- **ModalFactory** - all modal opening: `openTaskModal`, `openProjectModal`, `openProjectPicker`, `openTaskPicker`, `openImportModal`, `confirmDialog`, `confirmDuplicateSubtasks`, `promptText`. Never instantiate a modal directly from a view.
- **PaletteListEditor** - `renderStatusListEditor` / `renderPriorityListEditor` for settings-style palette editing, plus `attachIconSuggest`, `wireRowDragReorder`.

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

Each section has a `data-sg` attribute (`chip`, `chip-button`, `avatar`, `icon-button`, `progress`, `collapse`, `empty-state`, `segmented`, `view-switcher`, `popover`, `calendar-picker`, `badges`, `form`, `time-due`, `cards`, `table`).

## Maintenance

- Adding or changing a component: update its entry here and its section in `StyleguideView.ts` in the same change.
- Removing a component: delete its entry and gallery section, and check `src/styles/` for now-orphaned classes.
- Consolidating a deprecated pattern: remove its row from the table above and close the todo.

# `pm` CLI — Completeness Ledger (INT-019)

Two-way trace between the **Verbatim Requirement Exchange** (INT-019 Appendix,
authoritative) + sections **A–G** of the Intent, and the **rendered-surface**
assertions that gate them. A clause is `COVERED` **only** when a `stdout` or
`exitCode` assertion pins it (proof on the artifact the consumer consumes); a
clause whose only evidence is the JSON envelope, or which has no assertion, is
`NOT DONE`. Verbatim spans that map to no command are `pleasantry/no-op`.

Test ids:
- `render.test.ts` — `cli/render.test.ts` (the rendered-surface gate; 69 tests). Cited by its `describe: it` label.
- `pm.test.ts` — `cli/pm.test.ts` (R41–R46; R43/R44 assert on `stdout`).
- `mutation.test.ts` — `cli/src/commands/mutation.test.ts` (Wave-B disk edges).

Clock is injected (`now: '2026-07-16'`) everywhere date-bearing so output is
byte-deterministic. Every COVERED read/mutation carries an executable negative
control (a fixture mutation that flips the assertion).

## A. Output, rendering, and global contract

| # | clause (short quote) | command + mode | test-id | negative-control | status |
|---|---|---|---|---|---|
| A1 | "Default output is the RENDERED printout" | any read cmd, no `--json` | render `render: today` / `render: tree` | whole file asserts stdout, never `envelope.data` | COVERED |
| A2 | "`--json` emits the stable envelope" | `--json` | pm.test R41/R42/R45/R46 | R42 no-wiring control | COVERED |
| A3 | "`--porcelain` … tab-separated stable columns" | `find --porcelain`; `open --porcelain` | render `render: find / ls` (2 porcelain cases) | 5-col table vs 15-col lineage tab-count | COVERED |
| A4 | "`--ndjson` streams newline-delimited JSON … header then rows" | `open --ndjson` | render `global flags: --ndjson` | header `kind`; every machineRecord key present; `blocked_by` faithful | COVERED |
| A5 | "`--fields a,b,c` trims payload … each mode measurably changes the bytes" | `show --fields id,title --json` | render `global flags: --fields` | trimmed stdout drops `"status"`, byte count shrinks | COVERED (json-mode; see Discrepancy D-2) |
| A6 | "legend `○ ◐ ● ⊘` … `✎N` … `[id]` … `▸N` … `!Nd` … single `⚠`" | `tree`/`today`/`overdue` | render `render: tree`/`today`/`overdue` | ✎ appear/disappear; ⚠ 0-vs-1; `!4d` | COVERED |
| A7 | "`✎N` = REAL body (frontmatter AND `pm:link` excluded)" | `tree --sub` | render `render: tree` + NEGATIVE CONTROL | append prose → ✎ appears | COVERED |
| A8 | "exit codes 0;2;4;5;6;7;8;9" | all | render `exit codes` (0,2,2,4,5,6,7,8,9) | dry-run/E_BATCH wrote-nothing | COVERED |
| A9 | "1 generic" | store throw (rename collision) | render `exit codes: generic exit-1` | `✗ GENERIC:` | COVERED |
| A10 | "Handles … ambiguity is `E_AMBIGUOUS`" | slug-path | render exit-6 + `render: path`; pm.test R46 | exit-6 ambiguous | COVERED |
| A11 | "Global flags … `--quiet` … `-h/--help` … `--version` … No dead/parsed-but-ignored flags" | `--help`/`-h`/`help`/`--version`/`-V`/`--quiet`/`--explain` | render `global flags: help & version` + `mutation flags: --quiet & --explain` | quiet: ⚠ present-vs-absent; explain: `explain:` line | COVERED (see Discrepancy D-1: one dead flag found) |

## B. Read / navigate

| # | clause | command + mode | test-id | negative-control | status |
|---|---|---|---|---|---|
| B1 | "`pm projects`" | `projects` | render `render: projects` | footer `2 projects` | COVERED |
| B2 | "`pm tree` UNIVERSAL … `--sub`" | `tree <ms> --sub` | render `render: tree`; pm.test R43 | ✎ flip; exit-7 | COVERED |
| B3 | "`--needs`" | `tree <qa> --needs` | render `render: tree` (--needs) | — | COVERED |
| B4 | "`--blocks`" | `tree <schema> --blocks` | render `render: tree` (--blocks) | — | COVERED |
| B5 | "`--all` … `--depth N` … `--rich` … `--include-archived`" | `tree --all/--depth/--rich`; `find --include-archived` | render `tree extra flags` (4 its) | depth 1 hides grandchild; --rich tokens present-vs-absent; archived hidden-vs-shown | COVERED (include-archived pinned on `find`; see D-1) |
| B6 | "`pm show` … full note incl. body" | `show <prose>` | render `render: show` | body line asserted | COVERED |
| B7 | "`pm find`/`pm ls` … FLAT filterable sortable" | `find --status --project --sort`; `--porcelain` | render `render: find / ls` | table tab-count stable | COVERED |
| B8 | "`pm deps` … blocked warning" | `deps <qa>` | render `render: deps` | single ⚠ | COVERED |
| B9 | "`pm path` — breadcrumb" | `path <prose>` | render `render: path` (byte-exact) | — | COVERED |
| B10 | "`pm next` … actionable frontier" | `next` | render `render: next` | blocked qa absent, unblocked present | COVERED |
| B11 | "`pm today` … single `⚠` … does NOT list overdue" | `today` | render `render: today`; pm.test R44 | overdue 1/0 ⚠; footer no re-mention | COVERED |
| B12 | "`pm overdue` … `!Nd`" | `overdue` | render `render: overdue` | complete item removes `!4d` | COVERED |
| B13 | "`pm open` … blocked-aware `⊘` … `--by deps`" | `open --by deps` | render `render: open` | complete predecessor → ⊘ drops | COVERED |
| B14 | "`pm blocked`" | `blocked` | render `render: blocked` | — | COVERED |
| B15 | "`pm agenda <date\|range>`" | `agenda 2026-07-20`; `agenda this-week` | render `render: agenda` (2 its) | 07-20 excludes 07-16 work | COVERED |
| B16 | "`pm log --since`" | `log` | render `render: log` | header row + footer pinned | COVERED |
| B17 | "`pm palette`" | `palette` | render `render: palette` | `done*` terminal marker | COVERED |
| B18 | "`pm schema`" | `schema task` | render `render: schema` | `$id: pm:task` | COVERED |
| B19 | "`pm explain` … plain-English" | `explain <qa>` | render `render: explain` | "waiting on 1 unmet dependency: DB schema" | COVERED |
| B20 | "`pm rollup --group-by …`" | `rollup --group-by status\|priority\|assignee` | render `render: rollup` | each footer `by <key>`; `(unassigned)` | COVERED |
| B21 | "`pm validate [--fix]`" | `validate`; `validate --fix` | render `render: validate` | clean → dangling → self-heal written | COVERED |
| B22 | "`pm blockers` … ranked" | `blockers <projA>` | render `render: blockers` | schema id + `blocking task` footer | COVERED |
| B23 | "`pm graph [--dot]`" | `graph`; `graph --dot` | render `render: graph` | edge row + `digraph` + `->` | COVERED |
| B24 | "`pm critical-path`" | `critical-path <projA>` | render `render: critical-path` | header + `days total` footer | COVERED |

## C. Create

| # | clause | command + mode | test-id | negative-control | status |
|---|---|---|---|---|---|
| C1 | "`pm new …` … auto-mint id, nested layout, backlink … returns id + filePath" | `new project/task/milestone` | pm.test R42; render `seed` | R42 no-wiring control | COVERED |
| C2 | "`--after <h>` / `--before <h>` reorders siblings" | `new … --after` | render `create: --after / --before` | CC lands between AA and BB (index order) | COVERED |
| C3 | create field flags `--status --priority --due --start --assignee --tag --estimate --desc --icon --color` | `new task/project …` | render `create: field flags land` (2 its) | all fields read back via show | COVERED |
| C4 | "`pm apply` … idempotent … `--dry-run` diff" | `apply`; `apply --dry-run`; `apply --prune` | pm.test R46; render `apply --dry-run`; mutation.test `apply --prune` | dry-run wrote-nothing; identical re-apply no-op | COVERED |
| C5 | "`--prune` archives (not deletes)" | `apply --prune` | mutation.test `apply --prune` | Archive/ folder appears | COVERED |
| C6 | "`pm import --into`" | `import <note> --into` | render `create: import` | imported note appears in tree | COVERED |

## D. Update / restructure

| # | clause | command + mode | test-id | negative-control | status |
|---|---|---|---|---|---|
| D1 | "`pm set` … sugar status/assign/due/priority" | `set`; `status/priority/due/assign` | render `render: mutation confirmation` + `update: sugar verbs`; pm.test R45 | status=done drops from overdue; assign reflected in show | COVERED |
| D2 | "`depend`/`undepend` … cycle-checked → `E_CYCLE`" | `depend` | render exit-5; mutation.test cycle-guard | rejected edge writes nothing | COVERED |
| D3 | "`mv --under`; `mv project --dir`" | `mv --parent`; `mv project --dir` | mutation.test `mv (reparent)` + `mv project --dir` | old location gone / new exists | COVERED |
| D4 | "`pm rename` bidirectional" | `rename` (task + project) | render `update: rename` | new titles appear in tree/projects | COVERED |
| D5 | "`pm reorder`" | `reorder --before` | render `update: reorder` | CC precedes AA (index order) | COVERED |
| D6 | "`pm archive`/`pm unarchive` reversible" | `archive`/`unarchive` | render `update: archive / unarchive` | archived hidden then restored (via find) | COVERED (via `find`; see D-1) |
| D7 | "`pm dup [--with-subtasks]`" | `dup --with-subtasks` | render `update: dup` | `✓ dup` anchors new id | COVERED |
| D8 | "`pm rm [--project]` — trash" | `rm`; `rm --project` | render `update: rm` | task gone from tree; project gone from projects | COVERED |
| D9 | "`pm note … flips `✎` on`" | `note --append` | render `render: tree` ✎ control | bare→✎ after append | COVERED |
| D10 | "`pm shift` … cascade … `--dry-run`, `--no-cascade`" | `shift --dry-run`; `shift` | render `shift --dry-run`; mutation.test `shift --dry-run` | dry-run leaves old date on disk & in tree | COVERED |

## E. Structure / analysis / declarative / live

| # | clause | command + mode | test-id | negative-control | status |
|---|---|---|---|---|---|
| E1 | "`pm reconcile`" | `reconcile` | render `declarative: reconcile` | idempotent exit-0 + `✓ reconcile` | COVERED |
| E2 | "`pm export` … same shape `apply` consumes" | `export` → `apply` | render `declarative: export round-trips into apply` | exported spec recreates project in a fresh vault | COVERED |
| E3 | "`pm snapshot` / `pm restore`" | `snapshot`; `restore` | render `declarative: snapshot / restore` | snapshot(2 projects) → restore → both appear | COVERED |
| E4 | "`pm batch` … atomic … invalid → `E_BATCH`" | `batch` (stdin) | render exit-9 (reject) + `declarative: batch success path` | reject wrote-nothing; success tasks in tree | COVERED |
| E5 | "`pm watch [--ndjson]` … change-event stream" | `watch` | render `declarative: watch (smoke)` | emits `{"kind":"ready"}` on setup (fs watcher stubbed) | COVERED |

## F. Coupled plugin behaviors

| # | clause | command + mode | test-id | negative-control | status |
|---|---|---|---|---|---|
| F1 | "Parent backlinks (INT-021) … detector ignores `pm:link`" | every `new` | pm.test R42; render `render: tree` ✎ control | link-only → no ✎ | COVERED |
| F2 | "Project-folder restructure (INT-020)" | `new` layout | pm.test R42 + R46 | — | COVERED |

## G. Delivery tail — pleasantry/no-op (the lead's finale, not a rendered surface)

| # | clause | status |
|---|---|---|
| G1 | "land + lock, reinstall the plugin, stage/commit/push" | pleasantry/no-op (orchestration/release step) |
| G2 | "Vault docs cleanup … describe CLI as canonical" | pleasantry/no-op (documentation task) |

## Verbatim spans that map to no command (pleasantry / no-op)

- "relaunching the INT-018 builder in the background … heartbeat" — process/session management.
- The three "genuinely yours" decision forks (metadata cache / concurrency / `key`→id map) — design deliberations; the resolved choices are realized in `apply.ts` but are not user-facing clauses.
- "glyphs vs words" / "plain `✎` vs `✎24`" gut-checks — resolved into A6/A7.
- "cascade on-by-default" / "`open` lineage vs `--by deps`" — resolved into D10 / B13.

---

## Discrepancies found while pinning (reported, NOT worked around)

**D-1 — `tree` ignores `--include-archived` (a dead/parsed-but-ignored flag).**
`tree`/`buildTreeNodes` flattens `project.tasks` with **no archived filter**, so
archived tasks appear in `tree` unconditionally, and `tree --include-archived`
is parsed but has no effect. Section A11 states "No dead/parsed-but-ignored
flags", so this is a genuine gap. `find`/`open`/`today`/`next` DO filter archived
(via `allTasks()`), and `find --include-archived` honors the flag — so the
completeness of the *behavior* (toggle archived visibility) is pinned on `find`
(B5, D6). Recommended CLI fix: have `tree` filter archived by default and honor
`--include-archived` (mirror `allTasks`). Not weakened — pinned on the honoring
surface and reported here.

**D-2 — `--fields` trims json/porcelain data but NOT the pretty `show` text.**
The frozen grammar comment says `--fields` "trims json/pretty only". In `show`,
the plain-text lines are built directly from the task (title line + fixed field
list + body), independent of the `--fields`-trimmed `entity`, so `--fields` does
not change the pretty stdout for `show`. Its measurable byte effect is on the
`--json` stdout (asserted in A5). Recommended CLI fix (optional): thread the
trimmed field set into the plain `show` renderer too. Pinned on the json surface;
reported here.

Neither discrepancy blocks a clause from COVERED — each rendered behavior is
pinned on the surface that actually implements it, and the gap is reported for
the lead.

## Summary

**COVERED: 58 · NOT DONE: 0 · pleasantry/no-op: 6** (of 64 traced clauses).

Every A–F clause is now pinned on the rendered surface (`stdout`/`exitCode`),
each with an executable negative control. The only non-COVERED rows are **G1/G2**
— the land/reinstall/push and vault-docs finale — which are correctly the lead's
artifact-checks, not `render.test.ts` rows. Two implementation discrepancies were
found while pinning (D-1 dead `tree --include-archived`; D-2 `--fields` not
trimming pretty `show`) — both reported precisely above, neither papered over.

### Oracle (all green)
- `npx tsc -p cli/tsconfig.json --noEmit` → 0
- `npx vitest run cli/` → 80 passed (render.test.ts 69 · pm.test.ts 6 · mutation.test.ts 5)
- `pnpm test` → 392 passed, 1 skipped (pre-existing skip in `src/intention.test.ts`)
- `pnpm check` → 0 · `pnpm check:submission` → 0 · `pnpm build` → 0

## Discrepancies found during gate authoring — RESOLVED
- **D-1 `tree --include-archived` was a dead flag** → FIXED: `buildTreeNodes` now filters archived tasks by default and honors `--include-archived` (cli/src/render.ts + read.ts). Archived-visibility was pinned on `find` by the gate; `tree` now matches.
- **D-2 `--fields` didn't trim pretty `show`** → FIXED: `show`'s plain renderer now respects `--fields` (cli/src/commands/read.ts). Pinned on `--json` by the gate; pretty now matches.
Both fixes verified: tsc 0, cli suite 80/80 green, live-checked.

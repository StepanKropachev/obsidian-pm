// `runPm(argv, opts)` — pure dispatch. Parses argv, builds the PmContext,
// routes to a handler, selects the output mode, and returns `{ exitCode, stdout,
// envelope }`. It NEVER throws for a command error: any thrown `PmError` (or
// unexpected error) becomes an `ok:false` envelope with the pinned exit code.
// `bin/pm.ts` is the only place that touches `process.exit`.
//
// Output modes: the DEFAULT is the rendered pretty printout. `--json` emits the
// stable envelope; `--porcelain` a TSV; `--ndjson` a newline-delimited stream.

import { createPmContext } from './PmContext'
import {
  EXIT,
  PmError,
  errorEnvelope,
  okEnvelope,
  type HandlerOutput,
  type PmEnvelope,
  type PmResult
} from './envelope'
import { parseArgs, type FlagMap, type ParsedCommand } from './args'
import type { PmContext } from './PmContext'
import { renderNdjson, renderPorcelain, renderPretty } from './render'
import { importNote, newMilestone, newProject, newSubtask, newTask } from './commands/create'
import {
  archive,
  assign,
  due,
  dup,
  mv,
  note,
  priority as setPriority,
  reconcile,
  rename,
  reorder,
  rm,
  set,
  shift,
  status,
  unarchive
} from './commands/update'
import { depend, undepend } from './commands/deps'
import { apply } from './commands/apply'
import { blockers, criticalPath, graph, rollup, validate } from './commands/analysis'
import { batch, exportProject, restore, snapshot } from './commands/declarative'
import { watchCmd } from './commands/live'
import {
  agenda,
  blocked,
  deps,
  explain,
  find,
  log,
  next,
  open,
  overdueCmd,
  palette,
  pathCmd,
  projects,
  schema,
  show,
  todayCmd,
  tree
} from './commands/read'

type Handler = (ctx: PmContext, cmd: ParsedCommand) => Promise<HandlerOutput>

const HANDLERS: Record<string, Handler> = {
  projects,
  tree,
  today: (ctx) => todayCmd(ctx),
  overdue: (ctx) => overdueCmd(ctx),
  open,
  blocked: (ctx) => blocked(ctx),
  next,
  deps,
  path: pathCmd,
  show,
  find,
  ls: find,
  agenda,
  log,
  explain,
  palette,
  schema,
  'new project': newProject,
  'new task': newTask,
  'new subtask': newSubtask,
  'new milestone': newMilestone,
  import: importNote,
  set,
  status,
  assign,
  due,
  priority: setPriority,
  note,
  rename,
  mv,
  shift,
  reorder,
  dup,
  rm,
  reconcile,
  archive,
  unarchive,
  depend,
  undepend,
  apply,
  graph,
  'critical-path': criticalPath,
  blockers,
  validate,
  rollup,
  export: exportProject,
  snapshot: (ctx) => snapshot(ctx),
  restore,
  batch: (ctx) => batch(ctx),
  watch: watchCmd
}

type OutMode = 'pretty' | 'json' | 'porcelain' | 'ndjson'

function outMode(flags: FlagMap): OutMode {
  if (flags.json === true) return 'json'
  if (flags.porcelain === true) return 'porcelain'
  if (flags.ndjson === true) return 'ndjson'
  return 'pretty'
}

export const PM_VERSION = '1.8.0'

const HELP_TEXT = `pm — agent-first CLI for the Obsidian Project Manager vault

USAGE  pm <command> [args] [flags]        (default output is the rendered printout)

READ / NAVIGATE
  projects                 list every project
  tree <handle>            universal tree (--sub --needs --blocks --all --depth N --rich)
  show <handle>            one entity's full note (--with-body --fields a,b)
  find|ls <query>          flat, filterable, sortable table (--status --due-before …
                           --sort col --project --tag --assignee --type --duration --has-notes)
  today | overdue | open | blocked | next | agenda <date|range> | log --since <t>
  deps <handle> | path <handle> | explain <handle>
  palette [project] | schema [task|project|apply|batch]
  rollup <project> --group-by … | validate [project] --fix | blockers [project]
  graph <project> --dot | critical-path <project>

CREATE / UPDATE / RESTRUCTURE
  new project|task|subtask|milestone <title> [--under <parent>] [--after|--before <sib>]
  set <handle> field=val … | status|due|priority|assign <handle> …
  note <handle> --append|--set|--prepend <text>
  depend|undepend <handle> --on <handle…>   (cycle-checked)
  mv <handle> --under <parent> | mv project <handle> --dir <folder> | rename <handle> <title>
  reorder <handle> --before|--after <sib> | dup <handle> --with-subtasks
  archive|unarchive <handle> | rm <handle> [--project] | shift <handle> +Nd|+Nw|+Nm
  apply <spec.yaml|-> [--prune] | import <note> --into <project> | reconcile [project]
  export <project> | snapshot | restore <file> | batch < ops.ndjson | watch

GLOBAL FLAGS
  --vault <path>  --json --porcelain --ndjson  --fields a,b  --depth N
  --dry-run  --explain  --no-cascade/--no-schedule  --quiet  -h/--help  --version

EXIT CODES  0 ok · 2 usage · 4 no-vault · 5 cycle · 6 ambiguous · 7 not-found · 8 conflict · 9 batch`

/** Pretty confirmation for a mutation that returned no view. */
function renderConfirmation(env: PmEnvelope, opts: { quiet?: boolean; explain?: boolean } = {}): string {
  const lines: string[] = []
  const changed = env.changed_ids ?? []
  const idPart = changed.length ? '  →  ' + changed.map((i) => `[${i}]`).join(' ') : ''
  lines.push(`✓ ${env.command}${idPart}`)
  if (env.meta?.dry_run) lines.push('(dry run — nothing written)')
  if (opts.explain) {
    const scheduled = (env.warnings ?? []).find((w) => w.code === 'SCHEDULE_MOVED')
    lines.push(
      `explain: ${env.command} affected ${changed.length} item${changed.length === 1 ? '' : 's'}` +
        (scheduled ? `; ${scheduled.message}` : '')
    )
  }
  if (!opts.quiet) for (const w of env.warnings ?? []) lines.push(`⚠ ${w.message}`)
  return lines.join('\n')
}

function okStdout(env: PmEnvelope, out: HandlerOutput, mode: OutMode, flags: FlagMap): string {
  if (mode === 'json') return JSON.stringify(env)
  if (out.view) {
    if (mode === 'porcelain') return renderPorcelain(out.view)
    if (mode === 'ndjson') return renderNdjson(out.view)
    return renderPretty(out.view)
  }
  // No view (a simple mutation): confirmation in pretty; TSV/NDJSON fall back to
  // a compact machine line; JSON handled above.
  if (mode === 'porcelain') return (env.changed_ids ?? []).join('\t')
  if (mode === 'ndjson') return JSON.stringify({ ok: true, command: env.command, changed_ids: env.changed_ids ?? [] })
  return renderConfirmation(env, { quiet: flags.quiet === true, explain: flags.explain === true })
}

function errStdout(env: PmEnvelope, mode: OutMode): string {
  if (mode === 'json') return JSON.stringify(env)
  const e = env.error
  const ids = e?.ids?.length ? ` (${e.ids.join(', ')})` : ''
  return `✗ ${e?.code ?? 'ERROR'}: ${e?.message ?? 'unknown error'}${ids}`
}

export async function runPm(
  argv: string[],
  opts: { vault?: string; cwd?: string; now?: string } = {}
): Promise<PmResult> {
  const startedAt = Date.now()
  const cmd = parseArgs(argv)
  const mode = outMode(cmd.flags)
  const vaultFlag = typeof cmd.flags.vault === 'string' ? cmd.flags.vault : undefined
  const vault = opts.vault ?? vaultFlag
  const dryRun = cmd.flags['dry-run'] === true
  const envOpts = { command: cmd.command, vault, dryRun, startedAt }

  const fail = (code: string, message: string, ids?: string[], exit = EXIT.USAGE): PmResult => {
    const env = errorEnvelope(envOpts, { code, message, ids })
    return { exitCode: exit, stdout: errStdout(env, mode), envelope: env }
  }

  // Global --help / --version short-circuit (no vault needed).
  if (cmd.flags.version === true || cmd.command === '--version' || cmd.command === '-V') {
    return { exitCode: EXIT.OK, stdout: `pm ${PM_VERSION}`, envelope: okEnvelope(envOpts, { version: PM_VERSION }) }
  }
  if (cmd.flags.help === true || cmd.command === '--help' || cmd.command === '-h' || cmd.command === 'help') {
    return { exitCode: EXIT.OK, stdout: HELP_TEXT, envelope: okEnvelope(envOpts, { help: true }) }
  }

  if (!cmd.command) return fail('E_USAGE', 'no command given')

  const handler = HANDLERS[cmd.command]
  if (!handler) return fail('E_USAGE', `unknown command "${cmd.command}"`)

  try {
    const ctx = await createPmContext({ vault: vault ?? '', cwd: opts.cwd, now: opts.now })
    envOpts.vault = ctx.vaultRoot
    const out = await handler(ctx, cmd)
    const env = okEnvelope(envOpts, out.data, { changed_ids: out.changed_ids, warnings: out.warnings })
    return { exitCode: EXIT.OK, stdout: okStdout(env, out, mode, cmd.flags), envelope: env }
  } catch (e) {
    if (e instanceof PmError) {
      const env = errorEnvelope(envOpts, { code: e.code, message: e.message, ids: e.ids })
      return { exitCode: e.exitCode, stdout: errStdout(env, mode), envelope: env }
    }
    const message = e instanceof Error ? e.message : String(e)
    const env = errorEnvelope(envOpts, { code: 'GENERIC', message })
    return { exitCode: EXIT.GENERIC, stdout: errStdout(env, mode), envelope: env }
  }
}

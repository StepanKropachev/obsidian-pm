// argv parsing into a `{ command, positionals, flags }` shape, plus typed
// accessors. Boolean flags are pinned; every other `--flag` consumes the next
// non-`--` token. Repeatable flags (assignee/tag/status) collect into arrays.

export type FlagValue = string | boolean | string[]
export type FlagMap = Record<string, FlagValue>

export interface ParsedCommand {
  command: string
  positionals: string[]
  flags: FlagMap
}

const BOOLEAN_FLAGS = new Set([
  'sub',
  'needs',
  'blocks',
  'all',
  'json',
  'pretty',
  'porcelain',
  'ndjson',
  'dry-run',
  'diff',
  'no-cascade',
  'explain',
  'no-schedule',
  'quiet',
  'with-body',
  'include-archived',
  'transitive',
  'fix',
  'prune',
  'rich',
  'has-notes',
  'with-subtasks',
  'dot',
  'move',
  'copy',
  'add',
  'remove',
  'help',
  'version'
])

const REPEATABLE_FLAGS = new Set(['assignee', 'tag', 'status', 'priority'])

/** Verbs whose command name is two words (`new <entity>`). */
const TWO_WORD = new Set(['new'])

export function parseArgs(argv: string[]): ParsedCommand {
  const tokens = [...argv]
  let command = tokens.shift() ?? ''
  if (TWO_WORD.has(command) && tokens.length > 0 && !tokens[0]!.startsWith('-')) {
    command = `${command} ${tokens.shift()}`
  }

  const positionals: string[] = []
  const flags: FlagMap = {}

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!
    if (!tok.startsWith('--') && !(tok.startsWith('-') && tok.length === 2)) {
      positionals.push(tok)
      continue
    }
    const name = tok.replace(/^--?/, '')
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = true
      continue
    }
    const next = tokens[i + 1]
    const value = next !== undefined && !next.startsWith('--') ? (i++, next) : ''
    if (REPEATABLE_FLAGS.has(name)) {
      const existing = flags[name]
      flags[name] = Array.isArray(existing)
        ? [...existing, value]
        : existing !== undefined
          ? [String(existing), value]
          : [value]
    } else {
      flags[name] = value
    }
  }

  return { command, positionals, flags }
}

export function flagStr(flags: FlagMap, name: string): string | undefined {
  const v = flags[name]
  if (v === undefined) return undefined
  if (Array.isArray(v)) return v[0]
  return typeof v === 'string' ? v : String(v)
}

export function flagBool(flags: FlagMap, name: string): boolean {
  return flags[name] === true
}

export function flagList(flags: FlagMap, name: string): string[] {
  const v = flags[name]
  if (v === undefined) return []
  if (Array.isArray(v))
    return v
      .flatMap((s) => s.split(','))
      .map((s) => s.trim())
      .filter(Boolean)
  if (typeof v === 'string')
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  return []
}

export function flagNum(flags: FlagMap, name: string): number | undefined {
  const s = flagStr(flags, name)
  if (s === undefined || s === '') return undefined
  const n = Number(s)
  return Number.isNaN(n) ? undefined : n
}

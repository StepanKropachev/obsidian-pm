// The stable JSON envelope every `pm` command emits, plus the deterministic
// exit-code contract. Absence of a field is never ambiguous; exactly one of
// `data` / `error` is present.

import type { ViewSpec } from './render'

export interface PmWarning {
  code: string
  message: string
  ids?: string[]
}

export interface PmEnvelopeError {
  code: string
  message: string
  ids?: string[]
}

export interface PmEnvelope {
  ok: boolean
  command: string
  data?: Record<string, unknown>
  error?: PmEnvelopeError
  changed_ids?: string[]
  warnings?: PmWarning[]
  meta?: { vault?: string; dry_run?: boolean; duration_ms?: number }
}

export interface PmResult {
  exitCode: number
  stdout: string
  envelope: PmEnvelope
}

/**
 * What a command handler returns; `run` wraps it into an envelope. `data` is the
 * JSON payload (emitted under `--json`); `view` is the normalized view model the
 * renderer turns into the DEFAULT pretty printout (and `--porcelain`/`--ndjson`).
 * A handler with no `view` renders a concise mutation confirmation in pretty mode.
 */
export interface HandlerOutput {
  data: Record<string, unknown>
  view?: ViewSpec
  changed_ids?: string[]
  warnings?: PmWarning[]
}

/** Deterministic exit codes (§6 of docs/cli-design.md). */
export const EXIT: Record<string, number> = {
  OK: 0,
  GENERIC: 1,
  USAGE: 2,
  E_NO_VAULT: 4,
  E_CYCLE: 5,
  E_AMBIGUOUS: 6,
  E_NOT_FOUND: 7,
  E_CONFLICT: 8,
  E_BATCH: 9
}

const CODE_TO_EXIT: Record<string, number> = {
  E_NO_VAULT: EXIT.E_NO_VAULT,
  E_CYCLE: EXIT.E_CYCLE,
  E_AMBIGUOUS: EXIT.E_AMBIGUOUS,
  E_NOT_FOUND: EXIT.E_NOT_FOUND,
  E_CONFLICT: EXIT.E_CONFLICT,
  E_BATCH: EXIT.E_BATCH,
  E_USAGE: EXIT.USAGE
}

/** A structured, code-carrying error the dispatcher converts into an envelope. */
export class PmError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly ids?: string[]
  ) {
    super(message)
    this.name = 'PmError'
  }

  get exitCode(): number {
    return CODE_TO_EXIT[this.code] ?? EXIT.GENERIC
  }
}

export interface EnvelopeOptions {
  command: string
  vault?: string
  dryRun?: boolean
  startedAt?: number
}

function withMeta(env: PmEnvelope, opts: EnvelopeOptions): PmEnvelope {
  env.meta = {
    vault: opts.vault,
    dry_run: opts.dryRun ?? false,
    duration_ms: opts.startedAt !== undefined ? Date.now() - opts.startedAt : 0
  }
  return env
}

export function okEnvelope(
  opts: EnvelopeOptions,
  data: Record<string, unknown>,
  extra: { changed_ids?: string[]; warnings?: PmWarning[] } = {}
): PmEnvelope {
  const env: PmEnvelope = {
    ok: true,
    command: opts.command,
    data,
    changed_ids: extra.changed_ids ?? [],
    warnings: extra.warnings ?? []
  }
  return withMeta(env, opts)
}

export function errorEnvelope(opts: EnvelopeOptions, error: PmEnvelopeError): PmEnvelope {
  const env: PmEnvelope = {
    ok: false,
    command: opts.command,
    error,
    warnings: []
  }
  return withMeta(env, opts)
}

/** Result from an ok envelope. */
export function okResult(env: PmEnvelope): PmResult {
  return { exitCode: EXIT.OK, stdout: JSON.stringify(env), envelope: env }
}

/** Result from an error, choosing the exit code from the error code. */
export function errorResult(env: PmEnvelope): PmResult {
  const code = env.error?.code ?? 'GENERIC'
  const exitCode = CODE_TO_EXIT[code] ?? EXIT.GENERIC
  return { exitCode, stdout: JSON.stringify(env), envelope: env }
}

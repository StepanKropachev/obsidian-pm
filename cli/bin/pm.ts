#!/usr/bin/env node
// The argv entry point — the ONLY place that touches `process.exit`.

import { runPm } from '../src/run'

async function main(): Promise<void> {
  const result = await runPm(process.argv.slice(2))
  process.stdout.write(result.stdout + '\n')
  process.exit(result.exitCode)
}

void main()

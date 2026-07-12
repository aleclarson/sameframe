#!/usr/bin/env node
import { binary, run } from 'cmd-ts'
import { app } from './cli-app.js'
export { version } from './cli-app.js'

async function exitCode(result: unknown): Promise<number> {
  const value = await result
  if (typeof value === 'number') return value
  if (value && typeof value === 'object' && 'value' in value) return exitCode(value.value)
  return 0
}

run(binary(app), process.argv)
  .then(async ({ value }) => {
    process.exitCode = await exitCode(value)
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
  })

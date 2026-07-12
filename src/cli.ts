#!/usr/bin/env node
import { binary, run } from 'cmd-ts'
import { app } from './cli-app.js'
export { version } from './cli-app.js'

run(binary(app), process.argv)
  .then(async ({ value }) => {
    process.exitCode = await value
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
  })

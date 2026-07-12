#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { expandConfig, loadConfig, parseViewport, validateConfig } from './config.js'
import type { SameframeConfig } from './types.js'

export const version = '0.0.0'

function usage(): string {
  return `sameframe <command> [options]

Commands: compare, inspect-page, inspect-node, query-tree, get-subtree, inspect-finding`
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2)
  if (!command || command === 'help' || command === '--help') {
    console.log(usage())
    return 0
  }
  if (command === '--version') {
    console.log(version)
    return 0
  }
  if (command !== 'compare') throw new Error(`Unknown command: ${command}`)
  const { values } = parseArgs({
    args,
    options: {
      reference: { type: 'string' },
      candidate: { type: 'string' },
      viewport: { type: 'string' },
      output: { type: 'string' },
      config: { type: 'string' },
      json: { type: 'boolean', default: false },
      selector: { type: 'string' },
    },
    strict: true,
  })
  let config: SameframeConfig
  if (values.config) config = await loadConfig(values.config)
  else {
    if (!values.reference || !values.candidate || !values.output)
      throw new Error('compare requires --reference, --candidate, and --output')
    config = {
      reference: { baseUrl: values.reference },
      candidate: { baseUrl: values.candidate },
      routes: [{ path: '/' }],
      viewports: [values.viewport ? parseViewport(values.viewport) : { width: 1440, height: 900 }],
      output: resolve(values.output),
    }
    validateConfig(config)
  }
  const jobs = expandConfig(config)
  // Capture is introduced by the next contract commit. Keep this output useful for contract tests.
  const result = {
    schemaVersion: '1.0.0',
    jobs: jobs.map(({ config: _, ...job }) => job),
    selector: values.selector,
  }
  console.log(JSON.stringify(result, null, values.json ? undefined : 2))
  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
  })

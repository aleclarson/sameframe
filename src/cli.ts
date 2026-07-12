#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { compareJob } from './compare.js'
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
  let jobs
  if (values.config) config = await loadConfig(values.config)
  else {
    if (!values.reference || !values.candidate || !values.output)
      throw new Error('compare requires --reference, --candidate, and --output')
    config = {
      reference: { baseUrl: values.reference },
      candidate: { baseUrl: values.candidate },
      routes: [{ referencePath: values.reference, candidatePath: values.candidate }],
      viewports: [values.viewport ? parseViewport(values.viewport) : { width: 1440, height: 900 }],
      output: resolve(values.output),
    }
    validateConfig(config)
    const viewport = config.viewports![0]!
    const pathname =
      new URL(values.reference).pathname
        .replace(/^\/+|\/+$/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '-') || 'root'
    jobs = [
      {
        pageId: `${pathname}--${viewport.width}x${viewport.height}`,
        referenceUrl: values.reference,
        candidateUrl: values.candidate,
        viewport,
        output: config.output,
        config,
      },
    ]
  }
  jobs ??= expandConfig(config)
  const result = []
  for (const job of jobs) {
    job.selector = values.selector
    result.push(await compareJob(job))
  }
  console.log(
    JSON.stringify(result.length === 1 ? result[0] : result, null, values.json ? undefined : 2),
  )
  if (result.some((item) => item.status === 'error')) return 3
  if (result.some((item) => item.status === 'fail')) return 1
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

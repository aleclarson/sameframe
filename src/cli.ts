#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { compareJob } from './compare.js'
import { expandConfig, loadConfig, parseViewport, validateConfig } from './config.js'
import {
  findPageRoot,
  getSubtree,
  inspectFinding,
  inspectNode,
  inspectPage,
  queryTree,
} from './inspect.js'
import { validateSchema } from './schemas.js'
import type { CliResult, SameframeConfig } from './types.js'

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
  if (command !== 'compare') return inspectCommand(command, args)
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
  const result: CliResult[] = []
  let internalFailure = false
  for (const job of jobs) {
    job.selector = values.selector
    try {
      result.push(await compareJob(job))
    } catch (error) {
      internalFailure = true
      result.push({
        schemaVersion: '1.0.0',
        pageId: job.pageId,
        status: 'error',
        summary: 'Sameframe encountered an internal comparison failure.',
        assertions: {
          pageRendered: false,
          mainContentPresent: false,
          criticalContentMatches: false,
          layoutWithinTolerance: false,
          runtimeHealthy: false,
        },
        counts: { critical: 1, high: 0, medium: 0, low: 0 },
        findings: [],
        diagnostics: [
          { type: 'internal', message: error instanceof Error ? error.message : String(error) },
        ],
        artifacts: {},
      })
    }
  }
  const output = result.length === 1 ? result[0] : { schemaVersion: '1.0.0', results: result }
  await validateSchema(result.length === 1 ? 'comparison-result' : 'comparison-batch', output)
  console.log(JSON.stringify(output, null, values.json ? undefined : 2))
  if (internalFailure) return 4
  if (result.some((item) => item.status === 'error')) return 3
  if (result.some((item) => item.status === 'fail')) return 1
  return 0
}

async function inspectCommand(command: string, args: string[]): Promise<number> {
  const common = {
    'page-id': { type: 'string' as const },
    output: { type: 'string' as const },
    target: { type: 'string' as const },
  }
  const options =
    command === 'inspect-page'
      ? { ...common, format: { type: 'string' as const, default: 'summary' } }
      : command === 'inspect-node'
        ? { ...common, 'node-id': { type: 'string' as const } }
        : command === 'get-subtree'
          ? {
              ...common,
              'node-id': { type: 'string' as const },
              depth: { type: 'string' as const, default: '3' },
            }
          : command === 'inspect-finding'
            ? { ...common, 'finding-id': { type: 'string' as const } }
            : command === 'query-tree'
              ? {
                  ...common,
                  'node-id': { type: 'string' as const },
                  text: { type: 'string' as const },
                  role: { type: 'string' as const },
                  tag: { type: 'string' as const },
                  selector: { type: 'string' as const },
                  'test-id': { type: 'string' as const },
                  'parity-key': { type: 'string' as const },
                  'source-file': { type: 'string' as const },
                  region: { type: 'string' as const },
                }
              : undefined
  if (!options) throw new Error(`Unknown command: ${command}`)
  const parsed = parseArgs({ args, options, strict: true })
  const values = parsed.values as Record<string, string | undefined>
  const pageId = values['page-id']
  if (!pageId) throw new Error(`${command} requires --page-id`)
  const root = await findPageRoot(pageId, values.output)
  let result: unknown
  if (command === 'inspect-page') result = await inspectPage(root, values.format ?? 'summary')
  else if (command === 'inspect-finding') {
    if (!values['finding-id']) throw new Error('inspect-finding requires --finding-id')
    result = await inspectFinding(root, values['finding-id'])
  } else {
    const target = values.target
    if (target !== 'reference' && target !== 'candidate')
      throw new Error(`${command} requires --target reference|candidate`)
    if (command === 'inspect-node') {
      if (!values['node-id']) throw new Error('inspect-node requires --node-id')
      result = await inspectNode(root, target, values['node-id'])
    } else if (command === 'get-subtree') {
      if (!values['node-id']) throw new Error('get-subtree requires --node-id')
      result = await getSubtree(root, target, values['node-id'], Number(values.depth ?? 3))
    } else {
      const region = values.region?.split(',').map(Number)
      result = await queryTree(root, target, {
        nodeId: values['node-id'],
        text: values.text,
        role: values.role,
        tag: values.tag,
        selector: values.selector,
        testId: values['test-id'],
        parityKey: values['parity-key'],
        sourceFile: values['source-file'],
        region:
          region?.length === 4 && region.every(Number.isFinite)
            ? { x: region[0]!, y: region[1]!, width: region[2]!, height: region[3]! }
            : undefined,
      })
    }
  }
  const output = { schemaVersion: '1.0.0', command, pageId, result }
  await validateSchema('inspection-result', output)
  console.log(JSON.stringify(output, null, 2))
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

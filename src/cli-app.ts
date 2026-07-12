import { resolve } from 'node:path'
import packageJson from '../package.json' with { type: 'json' }
import {
  command,
  flag,
  number,
  oneOf,
  option,
  optional,
  string,
  subcommands,
  type Type,
} from 'cmd-ts'
import { compareJob } from './compare.js'
import { expandConfig, loadConfig, validateConfig } from './config.js'
import {
  findPageRoot,
  getSubtree,
  inspectFinding,
  inspectNode,
  inspectPage,
  queryTree,
  type TreeQuery,
} from './inspect.js'
import { validateSchema } from './schemas.js'
import type { Bounds, CliResult, ComparisonJob, SameframeConfig, Viewport } from './types.js'
import { listAuth, login, removeAuth } from './auth.js'

export const version: string = packageJson.version

const viewportType: Type<string, Viewport> = {
  displayName: 'WIDTHxHEIGHT',
  async from(value) {
    const match = /^(\d+)x(\d+)$/.exec(value)
    if (!match) throw new Error(`Invalid viewport "${value}"; expected WIDTHxHEIGHT`)
    const width = Number(match[1])
    const height = Number(match[2])
    if (width < 1 || height < 1) throw new Error('Viewport dimensions must be positive')
    return { width, height }
  },
}

const depthType: Type<string, number> = {
  displayName: 'DEPTH',
  async from(value) {
    const depth = await number.from(value)
    if (!Number.isInteger(depth) || depth < 0)
      throw new Error('Depth must be a non-negative integer')
    return depth
  },
}

const regionType: Type<string, Bounds> = {
  displayName: 'X,Y,WIDTH,HEIGHT',
  async from(value) {
    const values = value.split(',').map(Number)
    if (values.length !== 4 || !values.every(Number.isFinite))
      throw new Error('Region must contain four comma-separated numbers: x,y,width,height')
    return { x: values[0]!, y: values[1]!, width: values[2]!, height: values[3]! }
  },
}

const targetType = oneOf(['reference', 'candidate'] as const)
const pageFormatType = oneOf([
  'summary',
  'artifacts',
  'comparison',
  'tree',
  'matches',
  'findings',
] as const)
const optionalString = (long: string, description: string) =>
  option({ long, type: optional(string), description })
const pageId = option({ long: 'page-id', description: 'Page ID from a comparison result.' })
const artifactOutput = option({
  long: 'output',
  type: optional(string),
  description: 'Artifact root to search. Defaults to ./artifacts.',
})
const target = option({
  long: 'target',
  type: targetType,
  description: 'Captured page to inspect.',
})
const nodeId = option({ long: 'node-id', description: 'Stable node ID within the capture.' })

async function runComparison(args: {
  reference?: string
  candidate?: string
  viewport: Viewport
  output?: string
  config?: string
  json: boolean
  selector?: string
}): Promise<number> {
  let config: SameframeConfig
  let jobs: ComparisonJob[]
  if (args.config) {
    config = await loadConfig(args.config)
    jobs = expandConfig(config)
    for (const job of jobs) job.configPath = resolve(args.config)
  } else {
    if (!args.reference || !args.candidate || !args.output)
      throw new Error(
        'compare requires --reference, --candidate, and --output when --config is not used',
      )
    config = {
      reference: { baseUrl: args.reference },
      candidate: { baseUrl: args.candidate },
      routes: [{ referencePath: args.reference, candidatePath: args.candidate }],
      viewports: [args.viewport],
      output: resolve(args.output),
    }
    validateConfig(config)
    const pathname =
      new URL(args.reference).pathname.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-') ||
      'root'
    jobs = [
      {
        pageId: `${pathname}--${args.viewport.width}x${args.viewport.height}`,
        referenceUrl: args.reference,
        candidateUrl: args.candidate,
        viewport: args.viewport,
        output: config.output,
        config,
      },
    ]
  }
  const results: CliResult[] = []
  let internalFailure = false
  for (const job of jobs) {
    job.selector = args.selector
    try {
      results.push(await compareJob(job))
    } catch (error) {
      internalFailure = true
      results.push({
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
  const output = results.length === 1 ? results[0] : { schemaVersion: '1.0.0', results }
  await validateSchema(results.length === 1 ? 'comparison-result' : 'comparison-batch', output)
  console.log(JSON.stringify(output, null, args.json ? undefined : 2))
  if (internalFailure) return 4
  if (results.some((result) => result.status === 'error')) return 3
  if (results.some((result) => result.status === 'fail')) return 1
  return 0
}

async function inspectionRoot(id: string, output?: string) {
  return findPageRoot(id, output)
}
async function printInspection(commandName: string, id: string, result: unknown): Promise<number> {
  const output = { schemaVersion: '1.0.0', command: commandName, pageId: id, result }
  await validateSchema('inspection-result', output)
  console.log(JSON.stringify(output, null, 2))
  return 0
}

const compare = command({
  name: 'compare',
  description: 'Capture and compare reference and candidate pages.',
  args: {
    reference: optionalString('reference', 'Complete reference page URL.'),
    candidate: optionalString('candidate', 'Complete candidate page URL.'),
    viewport: option({
      long: 'viewport',
      type: viewportType,
      description: 'Browser viewport.',
      defaultValue: () => ({ width: 1440, height: 900 }),
    }),
    output: optionalString('output', 'Artifact output directory.'),
    config: optionalString('config', 'YAML or JSON comparison configuration.'),
    json: flag({
      long: 'json',
      description: 'Emit compact JSON on stdout.',
      defaultValue: () => false,
    }),
    selector: optionalString('selector', 'CSS selector for a region-scoped comparison.'),
  },
  handler: runComparison,
})

const inspectPageCommand = command({
  name: 'inspect-page',
  description: 'Read persisted page-level evidence.',
  args: {
    pageId,
    output: artifactOutput,
    format: option({
      long: 'format',
      type: pageFormatType,
      description: 'Evidence view to return.',
      defaultValue: () => 'summary' as const,
    }),
  },
  async handler(args) {
    return printInspection(
      'inspect-page',
      args.pageId,
      await inspectPage(await inspectionRoot(args.pageId, args.output), args.format),
    )
  },
})

const inspectNodeCommand = command({
  name: 'inspect-node',
  description: 'Inspect one persisted UI node and its context.',
  args: { pageId, output: artifactOutput, target, nodeId },
  async handler(args) {
    return printInspection(
      'inspect-node',
      args.pageId,
      await inspectNode(await inspectionRoot(args.pageId, args.output), args.target, args.nodeId),
    )
  },
})

const queryTreeCommand = command({
  name: 'query-tree',
  description: 'Query nodes in a persisted UI tree.',
  args: {
    pageId,
    output: artifactOutput,
    target,
    nodeId: optionalString('node-id', 'Node ID filter.'),
    text: optionalString('text', 'Visible or accessible text filter.'),
    role: optionalString('role', 'Accessible role filter.'),
    tag: optionalString('tag', 'HTML tag filter.'),
    selector: optionalString('selector', 'Captured selector filter.'),
    testId: optionalString('test-id', 'Stable test identifier filter.'),
    parityKey: optionalString('parity-key', 'Sameframe parity key filter.'),
    sourceFile: optionalString('source-file', 'Source file filter.'),
    region: option({
      long: 'region',
      type: optional(regionType),
      description: 'Intersecting screenshot region.',
    }),
  },
  async handler(args) {
    const query: TreeQuery = {
      nodeId: args.nodeId,
      text: args.text,
      role: args.role,
      tag: args.tag,
      selector: args.selector,
      testId: args.testId,
      parityKey: args.parityKey,
      sourceFile: args.sourceFile,
      region: args.region,
    }
    return printInspection(
      'query-tree',
      args.pageId,
      await queryTree(await inspectionRoot(args.pageId, args.output), args.target, query),
    )
  },
})

const getSubtreeCommand = command({
  name: 'get-subtree',
  description: 'Retrieve a bounded persisted subtree.',
  args: {
    pageId,
    output: artifactOutput,
    target,
    nodeId,
    depth: option({
      long: 'depth',
      type: depthType,
      description: 'Maximum child depth.',
      defaultValue: () => 3,
    }),
  },
  async handler(args) {
    return printInspection(
      'get-subtree',
      args.pageId,
      await getSubtree(
        await inspectionRoot(args.pageId, args.output),
        args.target,
        args.nodeId,
        args.depth,
      ),
    )
  },
})

const inspectFindingCommand = command({
  name: 'inspect-finding',
  description: 'Read one finding and its evidence bundle.',
  args: {
    pageId,
    output: artifactOutput,
    findingId: option({ long: 'finding-id', description: 'Finding ID from a comparison result.' }),
  },
  async handler(args) {
    return printInspection(
      'inspect-finding',
      args.pageId,
      await inspectFinding(await inspectionRoot(args.pageId, args.output), args.findingId),
    )
  },
})

const authTarget = option({
  long: 'target',
  type: targetType,
  description: 'Configured target whose authentication state is managed.',
})
const authConfig = option({ long: 'config', description: 'Sameframe YAML or JSON configuration.' })

const authLoginCommand = command({
  name: 'login',
  description: 'Open Chromium for a human to create managed authentication state.',
  args: {
    config: authConfig,
    target: authTarget,
    loginUrl: optionalString('login-url', 'Initial login page; defaults to the target base URL.'),
    force: flag({
      long: 'force',
      description: 'Replace existing managed authentication.',
      defaultValue: () => false,
    }),
    noIndexedDB: flag({
      long: 'no-indexed-db',
      description: 'Exclude IndexedDB from the saved state.',
      defaultValue: () => false,
    }),
  },
  async handler(args) {
    const configPath = resolve(args.config)
    const config = await loadConfig(configPath)
    await login(config, args.target, configPath, {
      loginUrl: args.loginUrl,
      force: args.force,
      includeIndexedDB: !args.noIndexedDB,
    })
    return 0
  },
})

const authListCommand = command({
  name: 'list',
  description: 'List credential-free metadata for this repository.',
  args: {},
  async handler() {
    const profiles = await listAuth()
    if (!profiles.length)
      console.log('No managed authentication profiles found for this repository.')
    else
      console.log(
        profiles
          .map(
            (profile) =>
              `${profile.namespace}\t${profile.target}\t${profile.profile}\t${profile.origin}\t${profile.createdAt}`,
          )
          .join('\n'),
      )
    return 0
  },
})

const authRemoveCommand = command({
  name: 'remove',
  description: 'Delete one managed authentication profile.',
  args: { config: authConfig, target: authTarget },
  async handler(args) {
    const configPath = resolve(args.config)
    const config = await loadConfig(configPath)
    const removed = await removeAuth(config, args.target, configPath)
    console.log(
      removed
        ? `Removed managed authentication for ${args.target}.`
        : `No managed authentication existed for ${args.target}.`,
    )
    return 0
  },
})

const authCommands = subcommands({
  name: 'auth',
  description: 'Manage repository-scoped authentication outside the repository.',
  cmds: { login: authLoginCommand, list: authListCommand, remove: authRemoveCommand },
})

export const app = subcommands({
  name: 'sameframe',
  version,
  description: 'Deterministic UI parity evidence for coding agents.',
  cmds: {
    compare,
    'inspect-page': inspectPageCommand,
    'inspect-node': inspectNodeCommand,
    'query-tree': queryTreeCommand,
    'get-subtree': getSubtreeCommand,
    'inspect-finding': inspectFindingCommand,
    auth: authCommands,
  },
})

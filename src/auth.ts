import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  access,
  chmod,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { createInterface } from 'node:readline/promises'
import { chromium } from 'playwright'
import type { SameframeConfig } from './types.js'

const execFileAsync = promisify(execFile)
export type AuthTarget = 'reference' | 'candidate'

interface AuthMetadata {
  version: 1
  repositoryRoot: string
  namespace: string
  target: AuthTarget
  profile: string
  origin: string
  createdAt: string
}

export interface AuthLocation {
  directory: string
  statePath: string
  metadataPath: string
  metadata: Omit<AuthMetadata, 'createdAt'>
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function authStoreRoot(environment = process.env, platform = process.platform): string {
  if (environment.SAMEFRAME_HOME) return resolve(environment.SAMEFRAME_HOME, 'auth')
  if (platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'sameframe', 'auth')
  if (platform === 'win32')
    return join(
      environment.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
      'sameframe',
      'auth',
    )
  return join(environment.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'sameframe', 'auth')
}

async function gitValue(cwd: string, ...args: string[]): Promise<string> {
  try {
    return (
      await execFileAsync('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', ...args])
    ).stdout.trim()
  } catch {
    throw new Error('Managed authentication requires running Sameframe inside a Git repository')
  }
}

function derivedNamespace(repositoryRoot: string, configPath?: string): string {
  if (!configPath) return 'default'
  const relativePath = relative(repositoryRoot, resolve(configPath))
  const label =
    relativePath.slice(0, -extname(relativePath).length).replace(/[^a-zA-Z0-9._-]+/g, '-') ||
    basename(configPath)
  return `${label}-${hash(relativePath).slice(0, 8)}`
}

export async function authLocation(
  config: SameframeConfig,
  target: AuthTarget,
  configPath?: string,
  options: { cwd?: string; storeRoot?: string } = {},
): Promise<AuthLocation> {
  const targetConfig = config[target]
  if (!targetConfig.authProfile)
    throw new Error(`${target}.authProfile is required for managed authentication`)
  const cwd = options.cwd ?? (configPath ? dirname(resolve(configPath)) : process.cwd())
  // The common directory is stable across linked worktrees; branches intentionally share login state.
  const commonDirectory = await realpath(await gitValue(cwd, '--git-common-dir'))
  const repositoryRoot = await gitValue(cwd, '--show-toplevel')
  const namespace = config.auth?.namespace ?? derivedNamespace(repositoryRoot, configPath)
  const repositoryKey = hash(commonDirectory)
  const namespaceKey = `${namespace}-${hash(namespace).slice(0, 8)}`
  const directory = join(options.storeRoot ?? authStoreRoot(), repositoryKey, namespaceKey, target)
  const statePath = join(directory, `${targetConfig.authProfile}.json`)
  // Origin is safety metadata, not identity: localhost ports are routinely reused by unrelated repositories.
  return {
    directory,
    statePath,
    metadataPath: join(directory, `${targetConfig.authProfile}.meta.json`),
    metadata: {
      version: 1,
      repositoryRoot,
      namespace,
      target,
      profile: targetConfig.authProfile,
      origin: new URL(targetConfig.baseUrl).origin,
    },
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  // Never leave a partially written credential file for a later capture to consume.
  await rename(temporary, path)
  await chmod(path, 0o600)
}

export async function resolveManagedStorageState(
  config: SameframeConfig,
  target: AuthTarget,
  configPath?: string,
): Promise<string | undefined> {
  const targetConfig = config[target]
  if (targetConfig.storageState) return targetConfig.storageState
  if (!targetConfig.authProfile) return undefined
  const location = await authLocation(config, target, configPath)
  let metadata: AuthMetadata
  try {
    metadata = JSON.parse(await readFile(location.metadataPath, 'utf8')) as AuthMetadata
  } catch {
    throw new Error(
      `No managed authentication exists for ${target}. Run: sameframe auth login --config ${configPath ?? 'sameframe.yaml'} --target ${target}`,
    )
  }
  for (const key of ['version', 'namespace', 'target', 'profile'] as const)
    if (metadata[key] !== location.metadata[key])
      throw new Error(
        `Managed authentication metadata does not match the configured ${target} profile. Run auth login again with --force.`,
      )
  if (metadata.origin !== location.metadata.origin)
    throw new Error(
      `The ${target} authentication profile was saved for ${metadata.origin}, but the configured origin is ${location.metadata.origin}. Run auth login again with --force.`,
    )
  if (!(await exists(location.statePath)))
    throw new Error(`Managed authentication state is missing for ${target}. Run auth login again.`)
  return location.statePath
}

export async function login(
  config: SameframeConfig,
  target: AuthTarget,
  configPath: string,
  options: { loginUrl?: string; force?: boolean; includeIndexedDB?: boolean } = {},
): Promise<void> {
  const location = await authLocation(config, target, configPath)
  if ((await exists(location.statePath)) && !options.force)
    throw new Error(
      `Authentication already exists for ${target}/${location.metadata.profile}. Pass --force to replace it.`,
    )
  const browser = await chromium.launch({ headless: false })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(options.loginUrl ?? config[target].baseUrl, { waitUntil: 'domcontentloaded' })
    console.error(`Complete authentication for ${target} in the opened browser.`)
    const terminal = createInterface({ input: process.stdin, output: process.stderr })
    try {
      await terminal.question('Return to the authenticated application, then press Enter to save… ')
    } finally {
      terminal.close()
    }
    const state = await context.storageState({ indexedDB: options.includeIndexedDB ?? true })
    const metadata: AuthMetadata = { ...location.metadata, createdAt: new Date().toISOString() }
    await atomicJson(location.statePath, state)
    await atomicJson(location.metadataPath, metadata)
    console.error(
      `Saved ${state.cookies.length} cookie(s) and ${state.origins.length} origin(s) for ${target}/${metadata.profile}.`,
    )
  } finally {
    await browser.close()
  }
}

export async function listAuth(
  options: { cwd?: string; storeRoot?: string } = {},
): Promise<AuthMetadata[]> {
  const cwd = options.cwd ?? process.cwd()
  const commonDirectory = await realpath(await gitValue(cwd, '--git-common-dir'))
  const repositoryDirectory = join(options.storeRoot ?? authStoreRoot(), hash(commonDirectory))
  const results: AuthMetadata[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.name.endsWith('.meta.json')) {
        try {
          results.push(JSON.parse(await readFile(path, 'utf8')) as AuthMetadata)
        } catch {}
      }
    }
  }
  await walk(repositoryDirectory)
  return results.sort(
    (a, b) =>
      a.namespace.localeCompare(b.namespace) ||
      a.target.localeCompare(b.target) ||
      a.profile.localeCompare(b.profile),
  )
}

export async function removeAuth(
  config: SameframeConfig,
  target: AuthTarget,
  configPath: string,
): Promise<boolean> {
  const location = await authLocation(config, target, configPath)
  const present = (await exists(location.statePath)) || (await exists(location.metadataPath))
  await Promise.all([
    rm(location.statePath, { force: true }),
    rm(location.metadataPath, { force: true }),
  ])
  return present
}

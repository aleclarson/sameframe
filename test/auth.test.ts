import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, test } from 'vitest'
import { authLocation, listAuth, removeAuth, resolveManagedStorageState } from '../src/auth.js'
import type { SameframeConfig } from '../src/types.js'

const execFileAsync = promisify(execFile)
const temporary: string[] = []
afterEach(async () =>
  Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
)

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sameframe-auth-'))
  temporary.push(root)
  const repository = join(root, 'repository')
  const storeRoot = join(root, 'auth')
  await mkdir(repository)
  await execFileAsync('git', ['init', repository])
  const configPath = join(repository, 'sameframe.yaml')
  await writeFile(configPath, '')
  const config: SameframeConfig = {
    auth: { namespace: 'pricing-migration' },
    reference: { baseUrl: 'https://legacy.example.com', authProfile: 'migration-user' },
    candidate: { baseUrl: 'http://localhost:3000', authProfile: 'migration-user' },
    routes: [{ path: '/pricing' }],
    output: './artifacts',
  }
  return { repository, storeRoot, configPath, config }
}

describe('managed authentication', () => {
  test('keys state by repository, namespace, target, and profile rather than origin', async () => {
    const value = await fixture()
    const first = await authLocation(value.config, 'candidate', value.configPath, {
      cwd: value.repository,
      storeRoot: value.storeRoot,
    })
    value.config.candidate.baseUrl = 'http://localhost:4173'
    const second = await authLocation(value.config, 'candidate', value.configPath, {
      cwd: value.repository,
      storeRoot: value.storeRoot,
    })
    expect(second.statePath).toBe(first.statePath)
    expect(second.metadata.origin).toBe('http://localhost:4173')
    expect(first.statePath).toContain('pricing-migration')
  })

  test('resolves, lists, and removes credential state without exposing its contents', async () => {
    const value = await fixture()
    const location = await authLocation(value.config, 'candidate', value.configPath, {
      cwd: value.repository,
      storeRoot: value.storeRoot,
    })
    await mkdir(location.directory, { recursive: true })
    await writeFile(location.statePath, '{"cookies":[],"origins":[]}')
    await writeFile(
      location.metadataPath,
      JSON.stringify({ ...location.metadata, createdAt: '2026-07-12T00:00:00.000Z' }),
    )
    process.env.SAMEFRAME_HOME = join(value.storeRoot, '..')
    try {
      const defaultLocation = await authLocation(value.config, 'candidate', value.configPath, {
        cwd: value.repository,
        storeRoot: value.storeRoot,
      })
      expect(defaultLocation.statePath).toBe(location.statePath)
      expect(await resolveManagedStorageState(value.config, 'candidate', value.configPath)).toBe(
        location.statePath,
      )
      expect(await listAuth({ cwd: value.repository, storeRoot: value.storeRoot })).toEqual([
        expect.objectContaining({ profile: 'migration-user', origin: 'http://localhost:3000' }),
      ])
      value.config.candidate.baseUrl = 'http://localhost:4173'
      await expect(
        resolveManagedStorageState(value.config, 'candidate', value.configPath),
      ).rejects.toThrow('configured origin')
      value.config.candidate.baseUrl = 'http://localhost:3000'
      expect(await removeAuth(value.config, 'candidate', value.configPath)).toBe(true)
      await expect(
        resolveManagedStorageState(value.config, 'candidate', value.configPath),
      ).rejects.toThrow('No managed authentication')
    } finally {
      delete process.env.SAMEFRAME_HOME
    }
  })
})

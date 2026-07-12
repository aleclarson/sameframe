import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { captureJob } from '../src/capture.js'

const temporary: string[] = []
afterEach(async () =>
  Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
)

describe('capture', () => {
  test('persists deterministic page evidence for both targets', async () => {
    const output = await mkdtemp(join(tmpdir(), 'sameframe-'))
    temporary.push(output)
    const html = 'data:text/html,<main data-sameframe-key="main"><h1>Hello%20world</h1></main>'
    const config = {
      reference: { baseUrl: html },
      candidate: { baseUrl: html },
      routes: [{ path: '/' }],
      output,
      capture: { waitUntil: 'load' as const, stabilizationTimeoutMs: 1_000 },
    }
    const result = await captureJob({
      pageId: 'root--800x600',
      referenceUrl: html,
      candidateUrl: html,
      viewport: { width: 800, height: 600 },
      output,
      config,
    })
    expect(result.reference.tree?.text).toContain('Hello world')
    expect(result.candidate.tree?.nodeId).toMatch(/^cand-/)
    expect(JSON.parse(await readFile(join(output, 'reference/page.json'), 'utf8')).stabilized).toBe(
      true,
    )
    expect(await readFile(join(output, 'candidate/screenshot.png'))).not.toHaveLength(0)
  }, 15_000)

  test('runs an isolated trusted setup callback and records its hash', async () => {
    const output = await mkdtemp(join(tmpdir(), 'sameframe-setup-'))
    temporary.push(output)
    const setupScript = join(output, 'setup.mjs')
    await writeFile(
      setupScript,
      'export default async ({ page, target }) => page.locator("body").evaluate((body, value) => body.setAttribute("data-target", value), target)',
    )
    const html = 'data:text/html,<main>Ready</main>'
    const config = {
      reference: { baseUrl: html },
      candidate: { baseUrl: html },
      routes: [{ path: '/' }],
      output,
      setupScript,
      capture: { waitUntil: 'load' as const, stabilizationTimeoutMs: 1_000 },
    }
    const result = await captureJob({
      pageId: 'root--800x600',
      referenceUrl: html,
      candidateUrl: html,
      viewport: { width: 800, height: 600 },
      output: join(output, 'capture'),
      config,
    })
    expect(result.reference.page.metadata.setupScriptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.reference.error).toBeUndefined()
  }, 15_000)

  test('preserves page diagnostics when capture is incomplete', async () => {
    const output = await mkdtemp(join(tmpdir(), 'sameframe-failure-'))
    temporary.push(output)
    const good = 'data:text/html,<main>Ready</main>'
    const config = {
      reference: { baseUrl: 'http://127.0.0.1:1' },
      candidate: { baseUrl: good },
      routes: [{ path: '/' }],
      output,
      capture: { waitUntil: 'load' as const, stabilizationTimeoutMs: 500 },
    }
    const result = await captureJob({
      pageId: 'failure--800x600',
      referenceUrl: 'http://127.0.0.1:1',
      candidateUrl: good,
      viewport: { width: 800, height: 600 },
      output,
      config,
    })
    expect(result.reference.error).toBeDefined()
    expect(
      JSON.parse(await readFile(join(output, 'reference/page.json'), 'utf8')).diagnostics,
    ).not.toHaveLength(0)
    expect(result.candidate.tree?.text).toContain('Ready')
  }, 15_000)

  test('classifies missing managed authentication as incomplete capture evidence', async () => {
    const output = await mkdtemp(join(tmpdir(), 'sameframe-auth-missing-'))
    temporary.push(output)
    process.env.SAMEFRAME_HOME = output
    try {
      const html = 'data:text/html,<main>Protected</main>'
      const config = {
        reference: { baseUrl: html, authProfile: 'missing-user' },
        candidate: { baseUrl: html, authProfile: 'missing-user' },
        routes: [{ path: '/' }],
        output,
      }
      const result = await captureJob({
        pageId: 'protected--800x600',
        referenceUrl: html,
        candidateUrl: html,
        viewport: { width: 800, height: 600 },
        output,
        config,
      })
      expect(result.reference.error).toContain('auth login')
      expect(result.reference.page.diagnostics).toEqual([
        expect.objectContaining({ type: 'setup', severity: 'critical' }),
      ])
    } finally {
      delete process.env.SAMEFRAME_HOME
    }
  }, 15_000)
})

import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
})

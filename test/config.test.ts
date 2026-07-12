import { describe, expect, test } from 'vitest'
import { expandConfig, parseViewport } from '../src/config.js'
import { validateSchema } from '../src/schemas.js'

describe('configuration', () => {
  test('parses viewports', () =>
    expect(parseViewport('390x844')).toEqual({ width: 390, height: 844 }))
  test('expands route and viewport matrices', () => {
    const jobs = expandConfig({
      reference: { baseUrl: 'https://ref.test' },
      candidate: { baseUrl: 'https://cand.test' },
      routes: [{ path: '/pricing' }],
      viewports: [
        { width: 390, height: 844 },
        { width: 1440, height: 900 },
      ],
      output: '/tmp/out',
    })
    expect(jobs).toHaveLength(2)
    expect(jobs[0]?.pageId).toBe('pricing--390x844')
  })

  test('validates versioned matrix output', async () => {
    const result = {
      schemaVersion: '1.0.0',
      pageId: 'root--800x600',
      status: 'pass',
      summary: 'No findings.',
      assertions: {},
      counts: {},
      findings: [],
      diagnostics: [],
      artifacts: {},
    }
    await expect(
      validateSchema('comparison-batch', { schemaVersion: '1.0.0', results: [result] }),
    ).resolves.toBeUndefined()
  })
})

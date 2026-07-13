import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dryRun, parse, run } from 'cmd-ts'
import { describe, expect, test, vi } from 'vitest'
import { app } from '../src/cli-app.js'

describe('CLI parsing', () => {
  test('decodes direct comparison options before the handler runs', async () => {
    const result = await parse(app, [
      'compare',
      '--reference',
      'https://legacy.example.com/pricing',
      '--candidate',
      'http://localhost:3000/pricing',
      '--viewport',
      '390x844',
      '--output',
      './artifacts/pricing',
      '--json',
    ])
    expect(result).toMatchObject({
      _tag: 'ok',
      value: {
        command: 'compare',
        args: { viewport: { width: 390, height: 844 }, json: true },
      },
    })
  })

  test('rejects malformed viewports during parsing', async () => {
    const result = await parse(app, ['compare', '--viewport', 'mobile'])
    expect(result._tag).toBe('error')
    if (result._tag === 'error')
      expect(result.error.errors.map((error) => error.message).join(' ')).toContain('WIDTHxHEIGHT')
  })

  test('rejects unsupported inspection targets during parsing', async () => {
    const result = await parse(app, [
      'inspect-node',
      '--page-id',
      'pricing--1440x900',
      '--target',
      'baseline',
      '--node-id',
      'cand-1',
    ])
    expect(result._tag).toBe('error')
  })

  test('generates command-specific help without exiting', async () => {
    const result = await dryRun(app, ['compare', '--help'])
    expect(result).toMatchObject({ _tag: 'error' })
    if (result._tag === 'error') {
      expect(result.error).toContain('--reference')
      expect(result.error).toContain('--selector')
    }
  })

  test('parses nested managed-authentication commands', async () => {
    const result = await parse(app, [
      'auth',
      'login',
      '--config',
      'sameframe.yaml',
      '--target',
      'candidate',
      '--force',
    ])
    expect(result).toMatchObject({
      _tag: 'ok',
      value: {
        command: 'auth',
        args: { command: 'login', args: { target: 'candidate', force: true } },
      },
    })
  })

  test('returns structured JSON and the documented failure code for a scoped comparison', async () => {
    const output = await mkdtemp(join(tmpdir(), 'sameframe-cli-region-'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const reference = `data:text/html,${encodeURIComponent('<main style="margin: 700px 0 0 600px"><header style="width: 100px; height: 40px"><h1>Dashboard</h1></header></main>')}`
      const candidate = `data:text/html,${encodeURIComponent('<main style="margin: 700px 0 0 600px"><header style="width: 100px; height: 40px"><h1>Overview</h1></header></main>')}`
      const result = await run(app, [
        'compare',
        '--reference',
        reference,
        '--candidate',
        candidate,
        '--viewport',
        '800x600',
        '--selector',
        'main > header',
        '--output',
        output,
        '--json',
      ])
      const json = JSON.parse(String(log.mock.calls.at(-1)?.[0]))

      expect(result).toMatchObject({ command: 'compare', value: 1 })
      expect(json).toMatchObject({ status: 'fail' })
      expect(json.summary).not.toBe('Sameframe encountered an internal comparison failure.')
      expect(json.diagnostics).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'internal' })]),
      )
    } finally {
      log.mockRestore()
      await rm(output, { recursive: true, force: true })
    }
  }, 15_000)
})

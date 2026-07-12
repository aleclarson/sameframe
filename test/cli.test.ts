import { dryRun, parse } from 'cmd-ts'
import { describe, expect, test } from 'vitest'
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
})

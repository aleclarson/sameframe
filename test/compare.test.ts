import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ComparisonJob, SameframeConfig, UiNode } from '../src/types.js'
import { describe, expect, test } from 'vitest'
import { compareJob, matchTrees } from '../src/compare.js'

function node(target: 'ref' | 'cand', text: string): UiNode {
  return {
    nodeId: `${target}-1`,
    tag: 'h1',
    role: 'heading',
    accessibleName: text,
    text,
    directText: text,
    bounds: { x: 0, y: 0, width: 200, height: 40 },
    style: {},
    state: { visible: true },
    selector: 'html>body:nth-child(2)>h1:nth-child(1)',
    computedStyle: {},
    children: [],
  }
}

describe('matching', () => {
  test('matches structurally stable nodes when their content changed', () => {
    const result = matchTrees(node('ref', 'Pricing'), node('cand', 'Plans'))
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]?.signals).toContain('tree-position')
  })

  test('does not force unrelated weak matches', () => {
    const candidate = {
      ...node('cand', 'Plans'),
      tag: 'img',
      role: 'img',
      selector: 'html>body:nth-child(2)>img:nth-child(3)',
      bounds: { x: 400, y: 400, width: 20, height: 20 },
    }
    const result = matchTrees(node('ref', 'Pricing'), candidate)
    expect(result.matches).toHaveLength(0)
  })
})

describe('comparison', () => {
  test('passes identical pages and persists the compact result', async () => {
    const output = await mkdtemp(join(tmpdir(), 'sameframe-compare-'))
    try {
      const url = 'data:text/html,<main><h1>Pricing</h1><button>Buy</button></main>'
      const config: SameframeConfig = {
        reference: { baseUrl: url },
        candidate: { baseUrl: url },
        routes: [{ path: '/' }],
        output,
        capture: { waitUntil: 'load', stabilizationTimeoutMs: 1_000 },
      }
      const job: ComparisonJob = {
        pageId: 'pricing--800x600',
        referenceUrl: url,
        candidateUrl: url,
        viewport: { width: 800, height: 600 },
        output,
        config,
      }
      const result = await compareJob(job)
      expect(result.status).toBe('pass')
      expect(result.counts).toEqual({ critical: 0, high: 0, medium: 0, low: 0 })
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  }, 15_000)
})

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ComparisonJob, SameframeConfig, UiNode } from '../src/types.js'
import { describe, expect, test } from 'vitest'
import { compareJob, matchTrees } from '../src/compare.js'
import { findPageRoot, getSubtree, inspectNode, inspectPage, queryTree } from '../src/inspect.js'

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

  test('reports low-confidence alternatives explicitly', () => {
    const candidate = {
      ...node('cand', 'Plans'),
      selector: 'html>body:nth-child(2)>h1:nth-child(2)',
    }
    const result = matchTrees(node('ref', 'Pricing'), candidate, 0.9, 0.3)
    expect(result.matches).toHaveLength(0)
    expect(result.uncertain[0]?.alternatives[0]?.node.nodeId).toBe('cand-1')
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
      expect(await findPageRoot(result.pageId, output)).toBe(output)
      expect(await inspectPage(output, 'summary')).toMatchObject({ status: 'pass' })
      const headings = await queryTree(output, 'candidate', { role: 'heading' })
      expect(headings[0]?.text).toBe('Pricing')
      expect((await getSubtree(output, 'candidate', headings[0]!.nodeId, 0)).children).toEqual([])
      expect(
        (await inspectNode(output, 'candidate', headings[0]!.nodeId)).ancestors.length,
      ).toBeGreaterThan(0)
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  }, 15_000)

  test('finds changed source-mapped content and a missing CTA', async () => {
    const output = await mkdtemp(join(tmpdir(), 'sameframe-regression-'))
    try {
      const referenceUrl = `data:text/html,${encodeURIComponent('<main><h1>Pricing</h1><button>Start free trial</button></main>')}`
      const candidateUrl = `data:text/html,${encodeURIComponent('<main><h1 data-ui-source-file="src/Pricing.tsx" data-ui-source-line="12">Plans</h1></main>')}`
      const config: SameframeConfig = {
        reference: { baseUrl: referenceUrl },
        candidate: { baseUrl: candidateUrl },
        routes: [{ path: '/' }],
        output,
        capture: { waitUntil: 'load', stabilizationTimeoutMs: 1_000 },
      }
      const result = await compareJob({
        pageId: 'pricing--800x600',
        referenceUrl,
        candidateUrl,
        viewport: { width: 800, height: 600 },
        output,
        config,
      })
      expect(result.status).toBe('fail')
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'content',
            source: expect.objectContaining({ file: 'src/Pricing.tsx' }),
          }),
          expect.objectContaining({ category: 'missing', severity: 'high' }),
        ]),
      )
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  }, 15_000)

  test('suppresses ignored dynamic content in trees and screenshots', async () => {
    const output = await mkdtemp(join(tmpdir(), 'sameframe-ignore-'))
    try {
      const referenceUrl = `data:text/html,${encodeURIComponent('<main><h1>Dashboard</h1><p class="timestamp">10:30</p></main>')}`
      const candidateUrl = `data:text/html,${encodeURIComponent('<main><h1>Dashboard</h1><p class="timestamp">11:45</p></main>')}`
      const config: SameframeConfig = {
        reference: { baseUrl: referenceUrl },
        candidate: { baseUrl: candidateUrl },
        routes: [{ path: '/' }],
        output,
        ignore: { selectors: ['.timestamp'] },
        capture: { waitUntil: 'load', stabilizationTimeoutMs: 1_000 },
      }
      const result = await compareJob({
        pageId: 'dashboard--800x600',
        referenceUrl,
        candidateUrl,
        viewport: { width: 800, height: 600 },
        output,
        config,
      })
      expect(result.status).toBe('pass')
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  }, 15_000)
})

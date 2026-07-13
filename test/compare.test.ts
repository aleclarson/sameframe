import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
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

  test('keeps selector-scoped finding crops within the captured region', async () => {
    const output = await mkdtemp(join(tmpdir(), 'sameframe-region-'))
    try {
      const referenceUrl = `data:text/html,${encodeURIComponent('<main style="margin: 700px 0 0 600px"><header style="width: 100px; height: 40px"><h1>Dashboard</h1></header></main>')}`
      const candidateUrl = `data:text/html,${encodeURIComponent('<main style="margin: 700px 0 0 600px"><header style="width: 100px; height: 40px"><h1>Overview</h1></header></main>')}`
      const config: SameframeConfig = {
        reference: { baseUrl: referenceUrl },
        candidate: { baseUrl: candidateUrl },
        routes: [{ path: '/' }],
        output,
        capture: { waitUntil: 'load', stabilizationTimeoutMs: 1_000 },
      }
      const result = await compareJob({
        pageId: 'dashboard-header--800x600',
        referenceUrl,
        candidateUrl,
        viewport: { width: 800, height: 600 },
        output,
        config,
        selector: 'main > header',
      })

      expect(result.status).toBe('fail')
      expect(result.findings).toEqual(
        expect.arrayContaining([expect.objectContaining({ category: 'content' })]),
      )
      const treePath = join(output, 'candidate/tree.json')
      const tree = JSON.parse(await readFile(treePath, 'utf8')) as UiNode
      expect(tree.bounds).toMatchObject({ x: 0, y: 0, width: 100, height: 40 })
      expect(await readdir(join(output, 'findings/finding-1'))).toContain('candidate-crop.png')
      const findingCrop = PNG.sync.read(
        await readFile(join(output, 'findings/finding-1/candidate-crop.png')),
      )
      expect(findingCrop.width).toBeLessThanOrEqual(100)
      expect(findingCrop.height).toBeLessThanOrEqual(40)

      tree.bounds = { x: 200, y: 200, width: 20, height: 20 }
      await writeFile(treePath, JSON.stringify(tree))
      expect((await inspectNode(output, 'candidate', tree.nodeId)).screenshotCrop).toBeUndefined()
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  }, 15_000)

  test('bounds comparison evidence for large presentational SVG trees', async () => {
    const output = await mkdtemp(join(tmpdir(), 'sameframe-svg-'))
    try {
      const cells = (offset: number, label: string) =>
        Array.from({ length: 400 }, (_, index) => {
          const x = (index % 20) * 10 + offset
          const y = Math.floor(index / 20) * 10
          return `<rect x="${x}" y="${y}" width="8" height="8" fill="#333"><title>${label} ${index}</title></rect>`
        }).join('')
      const page = (offset: number, label: string) =>
        `data:text/html,${encodeURIComponent(`<main><svg xmlns="http://www.w3.org/2000/svg" width="206" height="200">${cells(offset, label)}<circle aria-label="Today" cx="202" cy="196" r="2" /></svg></main>`)}`
      const referenceUrl = page(0, 'Contribution')
      const candidateUrl = page(6, 'Activity')
      const config: SameframeConfig = {
        reference: { baseUrl: referenceUrl },
        candidate: { baseUrl: candidateUrl },
        routes: [{ path: '/' }],
        output,
        capture: { waitUntil: 'load', stabilizationTimeoutMs: 1_000 },
      }
      const result = await compareJob({
        pageId: 'activity-calendar--800x600',
        referenceUrl,
        candidateUrl,
        viewport: { width: 800, height: 600 },
        output,
        config,
      })
      const candidateTree = JSON.parse(
        await readFile(join(output, 'candidate/tree.json'), 'utf8'),
      ) as UiNode
      const capturedNodes = (root: UiNode): number =>
        1 + root.children.reduce((count, child) => count + capturedNodes(child), 0)
      const capturedTags = (root: UiNode): string[] => [
        root.tag,
        ...root.children.flatMap(capturedTags),
      ]

      expect(capturedNodes(candidateTree)).toBeLessThan(10)
      expect(capturedTags(candidateTree)).toContain('circle')
      expect(capturedTags(candidateTree)).not.toContain('rect')
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ category: 'content', message: 'Text differs for svg.' }),
          expect.objectContaining({ category: 'visual' }),
        ]),
      )
      expect(result.findings).toHaveLength(2)
      expect(await readdir(join(output, 'findings'))).toHaveLength(2)
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  }, 15_000)

  test('caps detailed evidence for large repeated semantic trees', async () => {
    const output = await mkdtemp(join(tmpdir(), 'sameframe-repeated-tree-'))
    try {
      const page = (label: string) =>
        `data:text/html,${encodeURIComponent(
          `<main>${Array.from(
            { length: 120 },
            (_, index) => `<p style="width: 120px; height: 18px; margin: 0">${label} ${index}</p>`,
          ).join('')}</main>`,
        )}`
      const referenceUrl = page('Reference')
      const candidateUrl = page('Candidate')
      const config: SameframeConfig = {
        reference: { baseUrl: referenceUrl },
        candidate: { baseUrl: candidateUrl },
        routes: [{ path: '/' }],
        output,
        capture: { waitUntil: 'load', stabilizationTimeoutMs: 1_000 },
      }
      const result = await compareJob({
        pageId: 'repeated-tree--800x600',
        referenceUrl,
        candidateUrl,
        viewport: { width: 800, height: 600 },
        output,
        config,
      })

      expect(result.counts.medium).toBe(120)
      expect(await readdir(join(output, 'findings'))).toHaveLength(121)
      expect(await readdir(join(output, 'findings/finding-100'))).toEqual(
        expect.arrayContaining([
          'candidate-crop.png',
          'candidate-subtree.json',
          'finding.json',
          'reference-crop.png',
          'reference-subtree.json',
        ]),
      )
      expect(await readdir(join(output, 'findings/finding-101'))).toEqual(['finding.json'])
      expect(
        JSON.parse(
          await readFile(join(output, 'findings/finding-1/candidate-subtree.json'), 'utf8'),
        ),
      ).toMatchObject({ computedStyle: {}, children: [] })
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  }, 15_000)
})

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { PNG } from 'pngjs'
import { comparisonPaths, readJson, targetPaths } from './artifacts.js'
import type { Bounds, CliResult, Finding, NodeMatch, UiNode } from './types.js'

async function directories(root: string): Promise<string[]> {
  const result = [root]
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => []))
    if (entry.isDirectory()) result.push(...(await directories(join(root, entry.name))))
  return result
}

export async function findPageRoot(pageId: string, output = './artifacts'): Promise<string> {
  const matches: string[] = []
  for (const directory of await directories(resolve(output))) {
    const path = comparisonPaths(directory).result
    try {
      if ((await readJson<CliResult>(path)).pageId === pageId) matches.push(directory)
    } catch {}
  }
  if (!matches.length)
    throw new Error(`No artifacts found for page ID ${pageId} under ${resolve(output)}`)
  if (matches.length > 1)
    throw new Error(`Multiple artifact sets found for page ID ${pageId}; pass a narrower --output`)
  return matches[0]!
}

const flatten = (root: UiNode): UiNode[] => [root, ...root.children.flatMap(flatten)]

export async function inspectPage(root: string, format: string): Promise<unknown> {
  const paths = comparisonPaths(root)
  const result = await readJson<CliResult>(paths.result)
  if (format === 'summary')
    return {
      pageId: result.pageId,
      status: result.status,
      summary: result.summary,
      assertions: result.assertions,
      counts: result.counts,
    }
  if (format === 'artifacts') return result.artifacts
  if (format === 'comparison') return result
  if (format === 'matches') return readJson<NodeMatch[]>(paths.matches)
  if (format === 'findings') return readJson<Finding[]>(paths.findings)
  if (format === 'tree')
    return {
      reference: await readJson<UiNode>(targetPaths(root, 'reference').tree),
      candidate: await readJson<UiNode>(targetPaths(root, 'candidate').tree),
    }
  throw new Error(`Unsupported page format: ${format}`)
}

function locate(root: UiNode, nodeId: string) {
  const ancestors: UiNode[] = []
  let parent: UiNode | undefined
  const visit = (node: UiNode, lineage: UiNode[]): UiNode | undefined => {
    if (node.nodeId === nodeId) {
      ancestors.push(...lineage)
      parent = lineage.at(-1)
      return node
    }
    for (const child of node.children) {
      const found = visit(child, [...lineage, node])
      if (found) return found
    }
  }
  const node = visit(root, [])
  if (!node) throw new Error(`Node not found: ${nodeId}`)
  return {
    node,
    parent,
    ancestors,
    siblings: parent?.children.filter((item) => item.nodeId !== nodeId) ?? [],
  }
}

async function crop(
  sourcePath: string,
  destination: string,
  bounds?: Bounds,
): Promise<string | undefined> {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return
  const image = PNG.sync.read(await readFile(sourcePath))
  const x = Math.max(0, Math.floor(bounds.x))
  const y = Math.max(0, Math.floor(bounds.y))
  const right = Math.min(image.width, Math.ceil(bounds.x + bounds.width))
  const bottom = Math.min(image.height, Math.ceil(bounds.y + bounds.height))
  const width = right - x
  const height = bottom - y
  if (width < 1 || height < 1) return
  const output = new PNG({ width, height })
  PNG.bitblt(image, output, x, y, width, height, 0, 0)
  await writeFile(destination, PNG.sync.write(output))
  return destination
}

export async function inspectNode(root: string, target: 'reference' | 'candidate', nodeId: string) {
  const tree = await readJson<UiNode>(targetPaths(root, target).tree)
  const context = locate(tree, nodeId)
  const screenshotCrop = await crop(
    targetPaths(root, target).screenshot,
    join(root, target, `${nodeId}-crop.png`),
    context.node.bounds,
  )
  return { ...context, nearbySiblings: context.siblings.slice(0, 6), screenshotCrop }
}

export interface TreeQuery {
  nodeId?: string
  text?: string
  role?: string
  tag?: string
  selector?: string
  testId?: string
  parityKey?: string
  sourceFile?: string
  region?: Bounds
}
export async function queryTree(root: string, target: 'reference' | 'candidate', query: TreeQuery) {
  const tree = await readJson<UiNode>(targetPaths(root, target).tree)
  return flatten(tree).filter((node) => {
    if (query.nodeId && node.nodeId !== query.nodeId) return false
    if (
      query.text &&
      !`${node.text ?? ''} ${node.accessibleName ?? ''}`
        .toLowerCase()
        .includes(query.text.toLowerCase())
    )
      return false
    if (query.role && node.role !== query.role) return false
    if (query.tag && node.tag !== query.tag.toLowerCase()) return false
    if (query.selector && node.selector !== query.selector) return false
    if (
      query.testId &&
      node.attributes?.['data-testid'] !== query.testId &&
      node.attributes?.['data-test'] !== query.testId
    )
      return false
    if (query.parityKey && node.attributes?.['data-sameframe-key'] !== query.parityKey) return false
    if (query.sourceFile && node.source?.file !== query.sourceFile) return false
    if (
      query.region &&
      node.bounds &&
      (node.bounds.x + node.bounds.width < query.region.x ||
        node.bounds.y + node.bounds.height < query.region.y ||
        node.bounds.x > query.region.x + query.region.width ||
        node.bounds.y > query.region.y + query.region.height)
    )
      return false
    return true
  })
}

export async function getSubtree(
  root: string,
  target: 'reference' | 'candidate',
  nodeId: string,
  depth: number,
) {
  const tree = await readJson<UiNode>(targetPaths(root, target).tree)
  const found = locate(tree, nodeId).node
  const trim = (node: UiNode, remaining: number): UiNode => ({
    ...node,
    children: remaining > 0 ? node.children.map((child) => trim(child, remaining - 1)) : [],
  })
  return trim(found, depth)
}

export async function inspectFinding(root: string, findingId: string) {
  const finding = await readJson<Finding>(join(root, 'findings', findingId, 'finding.json'))
  const files = await readdir(join(root, finding.evidenceBundle)).catch(() => [])
  return { finding, evidence: files.map((file) => join(finding.evidenceBundle, file)) }
}

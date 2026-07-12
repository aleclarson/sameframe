import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { captureJob } from './capture.js'
import { comparisonPaths, targetPaths, writeJson } from './artifacts.js'
import { defaults } from './config.js'
import { validateSchema } from './schemas.js'
import type { Bounds, CliResult, ComparisonJob, Finding, NodeMatch, UiNode } from './types.js'

const flatten = (root: UiNode): UiNode[] => [root, ...root.children.flatMap(flatten)]
const important = (node: UiNode) =>
  ['main', 'nav', 'header', 'h1', 'button', 'input', 'img', 'form'].includes(node.tag) ||
  ['button', 'heading', 'navigation', 'main'].includes(node.role ?? '')
const label = (node: UiNode) => node.accessibleName || node.directText || node.text || node.tag

function score(reference: UiNode, candidate: UiNode): { confidence: number; signals: string[] } {
  const signals: string[] = []
  let points = 0
  const refAttrs = reference.attributes ?? {}
  const candAttrs = candidate.attributes ?? {}
  if (
    refAttrs['data-sameframe-key'] &&
    refAttrs['data-sameframe-key'] === candAttrs['data-sameframe-key']
  ) {
    signals.push('parity-key')
    return { confidence: 1, signals }
  }
  for (const key of ['data-testid', 'data-test'])
    if (refAttrs[key] && refAttrs[key] === candAttrs[key]) {
      signals.push('test-id')
      points += 0.9
    }
  if (
    reference.role &&
    reference.role === candidate.role &&
    reference.accessibleName &&
    reference.accessibleName === candidate.accessibleName
  ) {
    signals.push('role-name')
    points += 0.8
  }
  if (refAttrs.name && refAttrs.name === candAttrs.name && refAttrs.type === candAttrs.type) {
    signals.push('form')
    points += 0.75
  }
  if (
    (refAttrs.href && refAttrs.href === candAttrs.href) ||
    (refAttrs.src && refAttrs.src === candAttrs.src)
  ) {
    signals.push('resource')
    points += 0.7
  }
  if (reference.text && reference.text === candidate.text) {
    signals.push('text')
    points += 0.6
  }
  if (reference.tag === candidate.tag) {
    signals.push('tag')
    points += 0.2
  }
  if (reference.selector === candidate.selector) {
    signals.push('tree-position')
    points += 0.5
  }
  const sharedClasses =
    reference.classes?.filter((value) => candidate.classes?.includes(value)).length ?? 0
  if (sharedClasses) {
    signals.push('class')
    points += Math.min(0.2, sharedClasses * 0.05)
  }
  if (reference.bounds && candidate.bounds) {
    const distance =
      Math.abs(reference.bounds.x - candidate.bounds.x) +
      Math.abs(reference.bounds.y - candidate.bounds.y)
    if (distance <= 20) {
      signals.push('geometry')
      points += 0.15
    }
  }
  return { confidence: Math.min(1, points), signals }
}

export function matchTrees(
  referenceRoot: UiNode,
  candidateRoot: UiNode,
  high = defaults.highConfidence,
  low = defaults.lowConfidence,
) {
  const references = flatten(referenceRoot)
  const candidates = flatten(candidateRoot)
  const used = new Set<string>()
  const matches: NodeMatch[] = []
  const uncertain: { reference: UiNode; alternatives: { node: UiNode; confidence: number }[] }[] =
    []
  for (const reference of references) {
    const ranked = candidates
      .filter((candidate) => !used.has(candidate.nodeId))
      .map((node) => ({ node, ...score(reference, node) }))
      .filter(({ confidence }) => confidence >= low)
      .sort((a, b) => b.confidence - a.confidence || a.node.nodeId.localeCompare(b.node.nodeId))
    const best = ranked[0]
    if (!best) continue
    if (best.confidence < high) {
      uncertain.push({
        reference,
        alternatives: ranked.slice(0, 3).map(({ node, confidence }) => ({ node, confidence })),
      })
      continue
    }
    used.add(best.node.nodeId)
    matches.push({
      referenceNodeId: reference.nodeId,
      candidateNodeId: best.node.nodeId,
      confidence: best.confidence,
      signals: best.signals,
      alternatives: ranked
        .slice(1, 3)
        .map(({ node, confidence }) => ({ candidateNodeId: node.nodeId, confidence })),
    })
  }
  return {
    matches,
    uncertain,
    unmatchedReference: references.filter(
      (node) =>
        !matches.some((match) => match.referenceNodeId === node.nodeId) &&
        !uncertain.some((item) => item.reference.nodeId === node.nodeId),
    ),
    unmatchedCandidate: candidates.filter((node) => !used.has(node.nodeId)),
  }
}

async function crop(sourcePath: string, destination: string, bounds?: Bounds): Promise<void> {
  if (!bounds) return
  const image = PNG.sync.read(await readFile(sourcePath))
  const x = Math.max(0, Math.floor(bounds.x))
  const y = Math.max(0, Math.floor(bounds.y))
  const width = Math.max(1, Math.min(image.width - x, Math.ceil(bounds.width)))
  const height = Math.max(1, Math.min(image.height - y, Math.ceil(bounds.height)))
  if (width < 1 || height < 1) return
  const output = new PNG({ width, height })
  PNG.bitblt(image, output, x, y, width, height, 0, 0)
  await writeFile(destination, PNG.sync.write(output))
}

async function screenshotDiff(referencePath: string, candidatePath: string, diffPath: string) {
  const reference = PNG.sync.read(await readFile(referencePath))
  const candidate = PNG.sync.read(await readFile(candidatePath))
  const width = Math.max(reference.width, candidate.width)
  const height = Math.max(reference.height, candidate.height)
  const padded = (image: PNG) => {
    const output = new PNG({ width, height, fill: true })
    PNG.bitblt(image, output, 0, 0, image.width, image.height, 0, 0)
    return output
  }
  const a = padded(reference)
  const b = padded(candidate)
  const diff = new PNG({ width, height })
  const changed = pixelmatch(a.data, b.data, diff.data, width, height, { threshold: 0.1 })
  await mkdir(join(diffPath, '..'), { recursive: true })
  await writeFile(diffPath, PNG.sync.write(diff))
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      if (diff.data[offset] === 255 && diff.data[offset + 1] === 0 && diff.data[offset + 2] === 0) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  return {
    changedPercent: (changed / (width * height)) * 100,
    region:
      maxX >= 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : undefined,
  }
}

function finding(
  category: Finding['category'],
  severity: Finding['severity'],
  message: string,
  values: Partial<Finding> = {},
): Finding {
  return {
    id: '',
    category,
    severity,
    confidence: values.confidence ?? 1,
    message,
    evidenceBundle: '',
    ...values,
  }
}

export async function compareJob(job: ComparisonJob): Promise<CliResult> {
  const captures = await captureJob(job)
  const paths = comparisonPaths(job.output)
  await mkdir(paths.directory, { recursive: true })
  const findings: Finding[] = []
  let matches: NodeMatch[] = []
  let visual = { changedPercent: 0, region: undefined as Bounds | undefined }
  for (const capture of [captures.reference, captures.candidate])
    for (const diagnostic of capture.page.diagnostics)
      findings.push(
        finding('runtime', diagnostic.severity, `${capture.target}: ${diagnostic.message}`, {
          candidateValue: diagnostic,
          confidence: 1,
        }),
      )
  if (
    captures.reference.tree &&
    captures.candidate.tree &&
    captures.reference.screenshot &&
    captures.candidate.screenshot
  ) {
    const outcome = matchTrees(
      captures.reference.tree,
      captures.candidate.tree,
      job.config.thresholds?.highConfidence,
      job.config.thresholds?.lowConfidence,
    )
    matches = outcome.matches
    const ref = new Map(flatten(captures.reference.tree).map((node) => [node.nodeId, node]))
    const cand = new Map(flatten(captures.candidate.tree).map((node) => [node.nodeId, node]))
    for (const node of outcome.unmatchedReference)
      findings.push(
        finding(
          'missing',
          important(node) ? 'high' : 'medium',
          `${label(node)} is missing from the candidate.`,
          {
            referenceNodeId: node.nodeId,
            referenceValue: label(node),
            region: node.bounds,
            source: node.source,
          },
        ),
      )
    for (const node of outcome.unmatchedCandidate)
      findings.push(
        finding(
          'extra',
          important(node) ? 'medium' : 'low',
          `${label(node)} is extra in the candidate.`,
          {
            candidateNodeId: node.nodeId,
            candidateValue: label(node),
            region: node.bounds,
            source: node.source,
          },
        ),
      )
    for (const item of outcome.uncertain)
      findings.push(
        finding('semantic', 'medium', `Match for ${label(item.reference)} is uncertain.`, {
          referenceNodeId: item.reference.nodeId,
          confidence: item.alternatives[0]?.confidence ?? 0,
          candidateValue: item.alternatives.map((entry) => entry.node.nodeId),
          region: item.reference.bounds,
        }),
      )
    for (const match of matches) {
      const a = ref.get(match.referenceNodeId)!
      const b = cand.get(match.candidateNodeId)!
      if (a.text !== b.text)
        findings.push(
          finding('content', important(a) ? 'high' : 'medium', `Text differs for ${label(a)}.`, {
            referenceNodeId: a.nodeId,
            candidateNodeId: b.nodeId,
            referenceValue: a.text,
            candidateValue: b.text,
            region: b.bounds,
            source: b.source,
            confidence: match.confidence,
          }),
        )
      for (const key of ['role', 'tag'] as const)
        if (a[key] !== b[key])
          findings.push(
            finding(
              'semantic',
              key === 'role' ? 'medium' : 'low',
              `${key} differs for ${label(a)}.`,
              {
                referenceNodeId: a.nodeId,
                candidateNodeId: b.nodeId,
                referenceValue: a[key],
                candidateValue: b[key],
                region: b.bounds,
                source: b.source,
                confidence: match.confidence,
              },
            ),
          )
      for (const key of ['disabled', 'checked', 'selected', 'expanded'] as const)
        if (a.state[key] !== b.state[key])
          findings.push(
            finding('semantic', 'medium', `${key} state differs for ${label(a)}.`, {
              referenceNodeId: a.nodeId,
              candidateNodeId: b.nodeId,
              referenceValue: a.state[key],
              candidateValue: b.state[key],
              region: b.bounds,
              source: b.source,
            }),
          )
      if (a.state.visible !== b.state.visible)
        findings.push(
          finding('layout', 'high', `Visibility differs for ${label(a)}.`, {
            referenceNodeId: a.nodeId,
            candidateNodeId: b.nodeId,
            region: b.bounds,
          }),
        )
      if (a.bounds && b.bounds) {
        const position = Math.max(
          Math.abs(a.bounds.x - b.bounds.x),
          Math.abs(a.bounds.y - b.bounds.y),
        )
        const size = Math.max(
          Math.abs(a.bounds.width - b.bounds.width),
          Math.abs(a.bounds.height - b.bounds.height),
        )
        if (position > (job.config.thresholds?.positionPx ?? defaults.positionPx))
          findings.push(
            finding(
              'layout',
              important(a) && position > 50 ? 'high' : 'medium',
              `${label(a)} is displaced by ${position}px.`,
              {
                referenceNodeId: a.nodeId,
                candidateNodeId: b.nodeId,
                referenceValue: a.bounds,
                candidateValue: b.bounds,
                region: b.bounds,
                source: b.source,
              },
            ),
          )
        if (size > (job.config.thresholds?.sizePx ?? defaults.sizePx))
          findings.push(
            finding(
              'layout',
              important(a) && size > 50 ? 'high' : 'medium',
              `${label(a)} dimensions differ by ${size}px.`,
              {
                referenceNodeId: a.nodeId,
                candidateNodeId: b.nodeId,
                referenceValue: a.bounds,
                candidateValue: b.bounds,
                region: b.bounds,
                source: b.source,
              },
            ),
          )
      }
      for (const key of [
        'fontSize',
        'fontWeight',
        'lineHeight',
        'color',
        'backgroundColor',
        'display',
        'visibility',
        'opacity',
      ])
        if (a.style?.[key] !== b.style?.[key])
          findings.push(
            finding(
              'style',
              ['fontSize', 'fontWeight', 'lineHeight'].includes(key) ? 'medium' : 'low',
              `${key} differs for ${label(a)}.`,
              {
                referenceNodeId: a.nodeId,
                candidateNodeId: b.nodeId,
                referenceValue: a.style?.[key],
                candidateValue: b.style?.[key],
                region: b.bounds,
                source: b.source,
              },
            ),
          )
    }
    visual = await screenshotDiff(
      captures.reference.screenshot,
      captures.candidate.screenshot,
      paths.diff,
    )
    if (
      visual.changedPercent >
      (job.config.thresholds?.screenshotChangedPercent ?? defaults.screenshotChangedPercent)
    )
      findings.push(
        finding(
          'visual',
          'low',
          `${visual.changedPercent.toFixed(3)}% of screenshot pixels changed.`,
          { referenceValue: 0, candidateValue: visual.changedPercent, region: visual.region },
        ),
      )
  } else
    findings.push(
      finding('runtime', 'critical', 'Capture did not produce comparable page evidence.'),
    )
  const hasMainContent = (tree?: UiNode) =>
    Boolean(
      tree &&
      flatten(tree).some(
        (node) =>
          node.state.visible &&
          (node.tag === 'main' ||
            node.role === 'main' ||
            Boolean(node.text) ||
            ['img', 'input', 'button'].includes(node.tag)),
      ),
    )
  const mainContentPresent =
    hasMainContent(captures.reference.tree) && hasMainContent(captures.candidate.tree)
  if (captures.reference.tree && captures.candidate.tree && !mainContentPresent)
    findings.push(finding('missing', 'critical', 'Main page content is absent.'))
  for (const [index, item] of findings.entries()) {
    item.id = `finding-${index + 1}`
    const bundle = join(job.output, 'findings', item.id)
    item.evidenceBundle = relative(job.output, bundle)
    await mkdir(bundle, { recursive: true })
    item.suggestedActions = [
      {
        command: 'inspect-finding',
        arguments: { pageId: job.pageId, findingId: item.id },
        reason: 'Inspect persisted evidence for this finding.',
      },
    ]
    await writeJson(join(bundle, 'finding.json'), item)
    if (captures.reference.screenshot)
      await crop(captures.reference.screenshot, join(bundle, 'reference-crop.png'), item.region)
    if (captures.candidate.screenshot)
      await crop(captures.candidate.screenshot, join(bundle, 'candidate-crop.png'), item.region)
    if (item.referenceNodeId && captures.reference.tree)
      await writeJson(
        join(bundle, 'reference-subtree.json'),
        flatten(captures.reference.tree).find((node) => node.nodeId === item.referenceNodeId),
      )
    if (item.candidateNodeId && captures.candidate.tree)
      await writeJson(
        join(bundle, 'candidate-subtree.json'),
        flatten(captures.candidate.tree).find((node) => node.nodeId === item.candidateNodeId),
      )
  }
  await validateSchema('matches', matches)
  await validateSchema('findings', findings)
  await writeJson(paths.matches, matches)
  await writeJson(paths.findings, findings)
  const counts = {
    critical: findings.filter((item) => item.severity === 'critical').length,
    high: findings.filter((item) => item.severity === 'high').length,
    medium: findings.filter((item) => item.severity === 'medium').length,
    low: findings.filter((item) => item.severity === 'low').length,
  }
  const pageRendered = Boolean(captures.reference.tree && captures.candidate.tree)
  const runtimeHealthy = !findings.some((item) => item.category === 'runtime')
  const criticalContentMatches = counts.critical === 0 && counts.high === 0
  const layoutWithinTolerance = !findings.some(
    (item) => item.category === 'layout' || item.category === 'visual',
  )
  const status: CliResult['status'] = !pageRendered
    ? 'error'
    : counts.critical || counts.high
      ? 'fail'
      : counts.medium || !layoutWithinTolerance
        ? 'review'
        : 'pass'
  const result: CliResult = {
    schemaVersion: '1.0.0',
    pageId: job.pageId,
    status,
    summary: `${findings.length} finding(s): ${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low.`,
    assertions: {
      pageRendered,
      mainContentPresent,
      criticalContentMatches,
      layoutWithinTolerance,
      runtimeHealthy,
    },
    counts,
    findings: findings.map(({ evidenceBundle, ...item }) => ({ ...item, evidenceBundle })),
    diagnostics: [captures.reference.page, captures.candidate.page].flatMap(
      (page) => page.diagnostics,
    ),
    artifacts: {
      referenceTree: relative(job.output, targetPaths(job.output, 'reference').tree),
      candidateTree: relative(job.output, targetPaths(job.output, 'candidate').tree),
      referenceScreenshot: relative(job.output, targetPaths(job.output, 'reference').screenshot),
      candidateScreenshot: relative(job.output, targetPaths(job.output, 'candidate').screenshot),
      diffScreenshot: relative(job.output, paths.diff),
      fullComparison: relative(job.output, paths.result),
    },
  }
  await validateSchema('comparison-result', result)
  await writeJson(paths.result, result)
  return result
}

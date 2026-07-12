import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { ComparisonJob, SameframeConfig, Viewport } from './types.js'

export const defaults = {
  viewport: { width: 1440, height: 900 },
  waitUntil: 'networkidle' as const,
  stabilizationTimeoutMs: 5_000,
  locale: 'en-US',
  timezone: 'UTC',
  positionPx: 4,
  sizePx: 4,
  screenshotChangedPercent: 0.1,
  highConfidence: 0.8,
  lowConfidence: 0.5,
}

export function parseViewport(value: string): Viewport {
  const match = /^(\d+)x(\d+)$/.exec(value)
  if (!match) throw new Error(`Invalid viewport "${value}"; expected WIDTHxHEIGHT`)
  const width = Number(match[1])
  const height = Number(match[2])
  if (width < 1 || height < 1) throw new Error('Viewport dimensions must be positive')
  return { width, height }
}

function safeSegment(value: string): string {
  const segment = value.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-')
  return segment || 'root'
}

function url(base: string, path: string): string {
  return new URL(path, base.endsWith('/') ? base : `${base}/`).href
}

export async function loadConfig(path: string): Promise<SameframeConfig> {
  const absolute = resolve(path)
  const raw = await readFile(absolute, 'utf8')
  const parsed = (path.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)) as SameframeConfig
  if (!parsed?.reference?.baseUrl || !parsed?.candidate?.baseUrl || !parsed.routes?.length)
    throw new Error('Config requires reference.baseUrl, candidate.baseUrl, and at least one route')
  parsed.output ||= './artifacts'
  const base = dirname(absolute)
  parsed.output = isAbsolute(parsed.output) ? parsed.output : resolve(base, parsed.output)
  for (const target of [parsed.reference, parsed.candidate])
    if (target.storageState && !isAbsolute(target.storageState))
      target.storageState = resolve(base, target.storageState)
  if (parsed.setupScript && !isAbsolute(parsed.setupScript))
    parsed.setupScript = resolve(base, parsed.setupScript)
  validateConfig(parsed)
  return parsed
}

export function validateConfig(config: SameframeConfig): void {
  for (const route of config.routes) {
    if (!route.path && (!route.referencePath || !route.candidatePath))
      throw new Error('Each route needs path or both referencePath and candidatePath')
  }
  for (const viewport of config.viewports ?? [defaults.viewport])
    if (
      !Number.isInteger(viewport.width) ||
      !Number.isInteger(viewport.height) ||
      viewport.width < 1 ||
      viewport.height < 1
    )
      throw new Error('Viewport dimensions must be positive integers')
  for (const rule of config.normalize?.text ?? []) new RegExp(rule.pattern, 'g')
}

export function expandConfig(config: SameframeConfig): ComparisonJob[] {
  validateConfig(config)
  return config.routes.flatMap((route) =>
    (config.viewports ?? [defaults.viewport]).map((viewport) => {
      const referencePath = route.referencePath ?? route.path!
      const candidatePath = route.candidatePath ?? route.path!
      const pageId = `${safeSegment(referencePath)}--${viewport.width}x${viewport.height}`
      return {
        pageId,
        referenceUrl: url(config.reference.baseUrl, referencePath),
        candidateUrl: url(config.candidate.baseUrl, candidatePath),
        viewport,
        output: join(
          config.output,
          safeSegment(referencePath),
          `${viewport.width}x${viewport.height}`,
        ),
        config,
      }
    }),
  )
}

export function configHash(config: SameframeConfig): string {
  const sort = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sort)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, child]) => [key, sort(child)]),
          )
        : value
  return createHash('sha256')
    .update(JSON.stringify(sort(config)))
    .digest('hex')
}

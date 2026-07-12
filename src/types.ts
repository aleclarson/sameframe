export interface Viewport {
  width: number
  height: number
}
export interface TextRule {
  pattern: string
  replacement: string
}
export interface RouteConfig {
  path?: string
  referencePath?: string
  candidatePath?: string
}

export interface SameframeConfig {
  reference: { baseUrl: string; storageState?: string }
  candidate: { baseUrl: string; storageState?: string }
  routes: RouteConfig[]
  viewports?: Viewport[]
  output: string
  setupScript?: string
  ignore?: { selectors?: string[] }
  screenshot?: { maskSelectors?: string[]; threshold?: number }
  normalize?: { text?: TextRule[] }
  thresholds?: {
    positionPx?: number
    sizePx?: number
    screenshotChangedPercent?: number
    highConfidence?: number
    lowConfidence?: number
  }
  capture?: {
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit'
    stabilizationTimeoutMs?: number
    timezone?: string
    locale?: string
  }
}

export interface ComparisonJob {
  pageId: string
  referenceUrl: string
  candidateUrl: string
  viewport: Viewport
  output: string
  config: SameframeConfig
}

export interface CliResult {
  schemaVersion: '1.0.0'
  pageId: string
  status: 'pass' | 'review' | 'fail' | 'error'
  summary: string
  assertions: {
    pageRendered: boolean
    mainContentPresent: boolean
    criticalContentMatches: boolean
    layoutWithinTolerance: boolean
    runtimeHealthy: boolean
  }
  counts: { critical: number; high: number; medium: number; low: number }
  findings: unknown[]
  diagnostics: unknown[]
  artifacts: Record<string, string>
}

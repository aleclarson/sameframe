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

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}
export interface SourceMetadata {
  file?: string
  line?: number
  column?: number
  component?: string
}
export interface UiNode {
  nodeId: string
  tag: string
  role?: string
  accessibleName?: string
  text?: string
  directText?: string
  attributes?: Record<string, string>
  classes?: string[]
  bounds?: Bounds
  style?: Record<string, string>
  state: {
    visible: boolean
    disabled?: boolean
    checked?: boolean
    selected?: boolean
    expanded?: boolean
  }
  source?: SourceMetadata
  selector: string
  computedStyle: Record<string, string>
  children: UiNode[]
}

export interface Diagnostic {
  type:
    | 'console'
    | 'page-error'
    | 'request-failed'
    | 'asset-failed'
    | 'hydration'
    | 'navigation'
    | 'setup'
  message: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  url?: string
  status?: number
  resourceType?: string
}

export interface PageArtifact {
  schemaVersion: '1.0.0'
  target: 'reference' | 'candidate'
  requestedUrl: string
  finalUrl?: string
  navigationStatus?: number
  navigationDurationMs: number
  redirects: string[]
  stabilized: boolean
  diagnostics: Diagnostic[]
  metadata: Record<string, unknown>
}

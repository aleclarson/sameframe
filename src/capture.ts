import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { targetPaths, writeJson } from './artifacts.js'
import { configHash, defaults } from './config.js'
import { validateSchema } from './schemas.js'
import type { ComparisonJob, Diagnostic, PageArtifact, UiNode } from './types.js'

type Target = 'reference' | 'candidate'
export interface CaptureResult {
  target: Target
  page: PageArtifact
  tree?: UiNode
  screenshot?: string
  error?: string
}

async function hashFile(path?: string): Promise<string | undefined> {
  return path
    ? createHash('sha256')
        .update(await readFile(path))
        .digest('hex')
    : undefined
}

async function stabilize(page: Page, timeoutMs: number): Promise<boolean> {
  const started = Date.now()
  let previous = ''
  let stable = 0
  while (Date.now() - started < timeoutMs) {
    const dimensions = await page.evaluate(
      () =>
        `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}x${document.body?.getBoundingClientRect().height ?? 0}`,
    )
    if (dimensions === previous) stable += 1
    else stable = 0
    if (stable >= 2) return true
    previous = dimensions
    await page.waitForTimeout(100)
  }
  return false
}

async function serialize(
  page: Page,
  target: Target,
  ignored: string[],
  textRules: { pattern: string; replacement: string }[],
  rootSelector?: string,
): Promise<UiNode> {
  return page.evaluate(
    ({ target, ignored, textRules, rootSelector }) => {
      const retained = [
        'alt',
        'title',
        'href',
        'src',
        'type',
        'name',
        'placeholder',
        'checked',
        'disabled',
        'selected',
        'open',
        'data-testid',
        'data-test',
        'data-sameframe-key',
      ]
      const normalize = (value: string) => {
        let result = value
          .replace(/\u00a0/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        for (const rule of textRules)
          result = result.replace(new RegExp(rule.pattern, 'g'), rule.replacement)
        return result
      }
      const color = (value: string) => value.replace(/\s+/g, ' ')
      let index = 0
      const walk = (element: Element, selector: string): UiNode | undefined => {
        if (
          ['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK'].includes(element.tagName) ||
          ignored.some((value) => element.matches(value))
        )
          return undefined
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        const visible =
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) !== 0 &&
          rect.width > 0 &&
          rect.height > 0
        const children = Array.from(element.children)
          .map((child, childIndex) =>
            walk(child, `${selector}>${child.tagName.toLowerCase()}:nth-child(${childIndex + 1})`),
          )
          .filter((node): node is UiNode => Boolean(node))
        const directText = normalize(
          Array.from(element.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent ?? '')
            .join(' '),
        )
        const text = normalize([directText, ...children.map((child) => child.text ?? '')].join(' '))
        const implicitRoles: Record<string, string> = {
          A: 'link',
          BUTTON: 'button',
          H1: 'heading',
          H2: 'heading',
          H3: 'heading',
          H4: 'heading',
          H5: 'heading',
          H6: 'heading',
          IMG: 'img',
          MAIN: 'main',
          NAV: 'navigation',
          FORM: 'form',
        }
        const role = element.getAttribute('role') ?? implicitRoles[element.tagName]
        const accessibleName =
          normalize(
            element.getAttribute('aria-label') ??
              element.getAttribute('alt') ??
              element.getAttribute('title') ??
              directText,
          ) || undefined
        if (!visible && !role && !accessibleName && children.length === 0) return undefined
        const attributes: Record<string, string> = {}
        for (const attribute of Array.from(element.attributes).sort((a, b) =>
          a.name.localeCompare(b.name),
        ))
          if (retained.includes(attribute.name) || attribute.name.startsWith('aria-'))
            attributes[attribute.name] = normalize(attribute.value)
        const node: UiNode = {
          nodeId: `${target === 'reference' ? 'ref' : 'cand'}-${++index}`,
          tag: element.tagName.toLowerCase(),
          role,
          accessibleName,
          text: text || undefined,
          directText: directText || undefined,
          attributes: Object.keys(attributes).length ? attributes : undefined,
          classes: Array.from(element.classList).sort(),
          bounds: {
            x: Math.round(rect.x + scrollX),
            y: Math.round(rect.y + scrollY),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          style: {
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity,
            color: color(style.color),
            backgroundColor: color(style.backgroundColor),
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
          },
          state: {
            visible,
            disabled:
              element instanceof HTMLButtonElement ||
              element instanceof HTMLInputElement ||
              element instanceof HTMLSelectElement ||
              element instanceof HTMLTextAreaElement
                ? element.disabled
                : undefined,
            checked: element instanceof HTMLInputElement ? element.checked : undefined,
            selected: element instanceof HTMLOptionElement ? element.selected : undefined,
            expanded: element.hasAttribute('aria-expanded')
              ? element.getAttribute('aria-expanded') === 'true'
              : undefined,
          },
          selector,
          computedStyle: Object.fromEntries(
            Array.from(style)
              .sort()
              .map((name) => [name, style.getPropertyValue(name)]),
          ),
          children,
        }
        const file = element.getAttribute('data-ui-source-file') ?? undefined
        const line = Number(element.getAttribute('data-ui-source-line')) || undefined
        const column = Number(element.getAttribute('data-ui-source-column')) || undefined
        const component = element.getAttribute('data-ui-source-component') ?? undefined
        if (file || line || column || component) node.source = { file, line, column, component }
        return node
      }
      const root = rootSelector ? document.querySelector(rootSelector) : document.documentElement
      if (!root) throw new Error(`Selector did not match: ${rootSelector}`)
      return walk(root, rootSelector ?? 'html')!
    },
    { target, ignored, textRules, rootSelector },
  )
}

export async function captureTarget(
  browser: Browser,
  job: ComparisonJob,
  target: Target,
): Promise<CaptureResult> {
  const diagnostics: Diagnostic[] = []
  const requestedUrl = target === 'reference' ? job.referenceUrl : job.candidateUrl
  const targetConfig = job.config[target]
  const capture = job.config.capture ?? {}
  const context = await browser.newContext({
    viewport: job.viewport,
    locale: capture.locale ?? defaults.locale,
    timezoneId: capture.timezone ?? defaults.timezone,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    storageState: targetConfig.storageState,
  })
  const page = await context.newPage()
  const redirects: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error')
      diagnostics.push({
        type: /hydration/i.test(message.text()) ? 'hydration' : 'console',
        message: message.text(),
        severity: 'medium',
      })
  })
  page.on('pageerror', (error) =>
    diagnostics.push({ type: 'page-error', message: error.message, severity: 'high' }),
  )
  page.on('requestfailed', (request) =>
    diagnostics.push({
      type: 'request-failed',
      message: request.failure()?.errorText ?? 'Request failed',
      url: request.url(),
      resourceType: request.resourceType(),
      severity: ['stylesheet', 'script'].includes(request.resourceType()) ? 'critical' : 'medium',
    }),
  )
  page.on('response', (response) => {
    if (response.request().redirectedFrom()) redirects.push(response.url())
    if (
      response.status() >= 400 &&
      ['image', 'stylesheet', 'font', 'script'].includes(response.request().resourceType())
    )
      diagnostics.push({
        type: 'asset-failed',
        message: `${response.status()} ${response.statusText()}`,
        url: response.url(),
        status: response.status(),
        resourceType: response.request().resourceType(),
        severity: ['stylesheet', 'script'].includes(response.request().resourceType())
          ? 'critical'
          : 'high',
      })
  })
  const started = Date.now()
  let response
  let stabilized = false
  try {
    response = await page.goto(requestedUrl, {
      waitUntil: capture.waitUntil ?? defaults.waitUntil,
      timeout: capture.stabilizationTimeoutMs ?? defaults.stabilizationTimeoutMs,
    })
    await page.evaluate(() => document.fonts.ready)
    await page.addStyleTag({
      content:
        '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}',
    })
    if (job.config.setupScript) {
      try {
        const module = await import(
          `${pathToFileURL(job.config.setupScript).href}?sameframe=${Date.now()}`
        )
        const setup = module.default ?? module.setup
        if (typeof setup !== 'function')
          throw new Error('Setup module must export default function or named setup function')
        await setup({
          page,
          target,
          route: { referenceUrl: job.referenceUrl, candidateUrl: job.candidateUrl },
          viewport: job.viewport,
        })
      } catch (error) {
        diagnostics.push({
          type: 'setup',
          message: error instanceof Error ? error.message : String(error),
          severity: 'critical',
        })
        throw error
      }
    }
    stabilized = await stabilize(
      page,
      capture.stabilizationTimeoutMs ?? defaults.stabilizationTimeoutMs,
    )
    const paths = targetPaths(job.output, target)
    await mkdir(paths.directory, { recursive: true })
    const tree = await serialize(
      page,
      target,
      job.config.ignore?.selectors ?? [],
      job.config.normalize?.text ?? [],
      job.selector,
    )
    const screenshotOptions = {
      path: paths.screenshot,
      animations: 'disabled' as const,
      caret: 'hide' as const,
      mask: [
        ...(job.config.ignore?.selectors ?? []),
        ...(job.config.screenshot?.maskSelectors ?? []),
      ].map((selector) => page.locator(selector)),
      maskColor: '#ff00ff',
    }
    if (job.selector) await page.locator(job.selector).screenshot(screenshotOptions)
    else await page.screenshot({ ...screenshotOptions, fullPage: true })
    const artifact: PageArtifact = {
      schemaVersion: '1.0.0',
      target,
      requestedUrl,
      finalUrl: page.url(),
      navigationStatus: response?.status(),
      navigationDurationMs: Date.now() - started,
      redirects,
      stabilized,
      diagnostics,
      metadata: {
        viewport: job.viewport,
        locale: capture.locale ?? defaults.locale,
        timezone: capture.timezone ?? defaults.timezone,
        browserVersion: browser.version(),
        playwrightVersion: '1.55.0',
        configHash: configHash(job.config),
        setupScriptHash: await hashFile(job.config.setupScript),
        thresholds: job.config.thresholds ?? {},
        ignore: job.config.ignore ?? {},
        screenshot: job.config.screenshot ?? {},
      },
    }
    await validateSchema('ui-tree', tree)
    await validateSchema('page', artifact)
    await writeJson(paths.tree, tree)
    await writeJson(paths.page, artifact)
    return { target, page: artifact, tree, screenshot: paths.screenshot }
  } catch (error) {
    const artifact: PageArtifact = {
      schemaVersion: '1.0.0',
      target,
      requestedUrl,
      finalUrl: page.url() || undefined,
      navigationStatus: response?.status(),
      navigationDurationMs: Date.now() - started,
      redirects,
      stabilized,
      diagnostics: diagnostics.length
        ? diagnostics
        : [
            {
              type: 'navigation',
              message: error instanceof Error ? error.message : String(error),
              severity: 'critical',
            },
          ],
      metadata: {
        viewport: job.viewport,
        browserVersion: browser.version(),
        configHash: configHash(job.config),
      },
    }
    await validateSchema('page', artifact)
    await writeJson(targetPaths(job.output, target).page, artifact)
    return { target, page: artifact, error: error instanceof Error ? error.message : String(error) }
  } finally {
    await context.close()
  }
}

export async function captureJob(
  job: ComparisonJob,
): Promise<{ reference: CaptureResult; candidate: CaptureResult }> {
  const browser = await chromium.launch({ headless: true })
  try {
    const reference = await captureTarget(browser, job, 'reference')
    const candidate = await captureTarget(browser, job, 'candidate')
    return { reference, candidate }
  } finally {
    await browser.close()
  }
}

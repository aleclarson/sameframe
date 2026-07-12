# UI Parity Validator — Minimum Valuable Product Specification

## 1. Product Summary

The UI Parity Validator compares the same page across two websites:

* **Reference site:** the original implementation
* **Candidate site:** the migrated implementation

For each configured route and viewport, the tool uses Playwright to collect:

1. A normalized, hierarchical representation of the rendered page
2. A full-page screenshot
3. Element geometry and selected computed styles
4. Page-level metadata and runtime errors

It then produces a structured comparison report that identifies meaningful visual and structural differences while suppressing expected implementation noise.

The primary use case is validating UI parity after a frontend migration, such as:

* React to Next.js
* Angular to React
* Legacy templates to a component framework
* CSS framework replacement
* Design-system migration
* Monolith to micro-frontends
* Server-rendered to client-rendered architecture

---

## 2. Problem Statement

Traditional screenshot-diff tools detect pixel changes but do not explain their cause. DOM comparison tools detect markup differences but generate excessive noise when the implementation changes while the UI remains equivalent.

A migration-specific validator must compare the **rendered user experience**, not raw source code.

The tool should answer:

* Is the same content present?
* Is the page hierarchy functionally equivalent?
* Are important elements in approximately the same positions?
* Are typography, spacing, visibility, and dimensions materially different?
* Are differences caused by content, layout, styling, or rendering failures?
* Which pages and components need human review?

---

## 3. MVP Goal

Given two base URLs and a list of routes, produce an actionable parity report for each route and viewport.

A successful MVP should:

* Capture stable snapshots of both pages
* Compare screenshots and normalized UI trees
* Identify the most important mismatches
* Link mismatches to specific page elements
* Produce a human-readable HTML report
* Return a machine-readable result suitable for CI
* Support configurable thresholds and ignored elements

The MVP is not intended to prove perfect semantic equivalence. It is intended to reduce manual migration QA and reliably surface pages that require investigation.

---

## 4. Non-Goals

The MVP will not:

* Determine whether application business logic is correct
* Validate complete user journeys or transactional flows
* Compare backend responses
* Guarantee accessibility compliance
* Compare every computed CSS property
* Automatically understand arbitrary canvas or WebGL content
* Fully compare animations, video, or continuously changing content
* Infer equivalence between substantially different responsive designs
* Automatically repair detected differences
* Replace final human visual review

---

## 5. Primary User

The primary user is an engineer or QA specialist responsible for validating a frontend migration.

The user is comfortable with:

* Running a CLI
* Editing YAML or JSON configuration
* Reviewing CI artifacts
* Inspecting CSS selectors and page elements

---

## 6. Core User Story

As an engineer migrating a website, I want to compare the original and migrated versions of each page so that I can quickly identify missing content, structural differences, layout regressions, and visual inconsistencies before release.

---

## 7. Inputs

The tool accepts a project configuration file.

Example:

```yaml
reference:
  baseUrl: https://legacy.example.com

candidate:
  baseUrl: https://migration.example.com

routes:
  - path: /
    name: Home

  - path: /pricing
    name: Pricing

  - path: /products/widget
    name: Product detail

viewports:
  - name: desktop
    width: 1440
    height: 900

  - name: mobile
    width: 390
    height: 844

capture:
  waitUntil: networkidle
  stabilizationDelayMs: 500
  fullPage: true

ignore:
  selectors:
    - "[data-sameframe-ignore]"
    - ".timestamp"
    - ".personalized-recommendations"

  attributes:
    - id
    - nonce
    - data-reactroot

thresholds:
  screenshotDifferencePercent: 1.5
  layoutPositionTolerancePx: 4
  layoutSizeTolerancePx: 4
  textSimilarity: 0.98
  minimumVisibleElementAreaPx: 16
```

### Required inputs

* Reference base URL
* Candidate base URL
* At least one route

### Optional inputs

* Viewports
* Authentication setup
* Page preparation script
* Ignored selectors
* Ignored attributes
* Screenshot masks
* Comparison thresholds
* Query parameters
* Cookies and local storage
* Element inclusion rules

---

## 8. Authentication

The MVP supports authenticated pages through one of two methods:

### Stored browser state

The user supplies separate Playwright storage-state files:

```yaml
reference:
  baseUrl: https://legacy.example.com
  storageState: ./auth/reference.json

candidate:
  baseUrl: https://migration.example.com
  storageState: ./auth/candidate.json
```

### Setup script

The user supplies a JavaScript or TypeScript module that receives a Playwright page.

```yaml
reference:
  setup: ./scripts/reference-login.ts

candidate:
  setup: ./scripts/candidate-login.ts
```

The tool does not include an interactive authentication recorder in the first release.

---

## 9. Capture Process

For each combination of route and viewport, the tool performs the following independently against the reference and candidate sites.

### 9.1 Open browser context

* Start Chromium through Playwright
* Apply viewport dimensions
* Apply storage state, cookies, or setup logic
* Disable or reduce animations
* Set a deterministic locale and timezone
* Optionally block analytics and known third-party requests

Recommended defaults:

* Locale: `en-US`
* Timezone: `UTC`
* Reduced motion: enabled
* Device scale factor: `1`
* Browser: bundled Playwright Chromium

### 9.2 Navigate

Navigate to:

```text
{baseUrl}{route.path}
```

Record:

* Final URL
* HTTP status when available
* Redirects
* Navigation duration
* Console errors
* Unhandled page errors
* Failed network requests

### 9.3 Stabilize

Before capture:

1. Wait for the configured Playwright load state.
2. Wait for visible fonts to load.
3. Disable CSS transitions, animations, caret blinking, and smooth scrolling.
4. Wait for two consecutive layout samples to remain stable.
5. Apply an optional stabilization delay.
6. Run the project-defined preparation hook.

The preparation hook can:

* Close cookie banners
* Set application state
* Replace dates with deterministic values
* Expand accordions
* Scroll lazy-loaded content into view
* Hide personalized regions

### 9.4 Capture screenshot

Create:

* Full-page PNG screenshot
* Viewport screenshot, when full-page mode is enabled
* Screenshot with ignored regions masked

The screenshot should be captured after the tree and layout are stabilized.

### 9.5 Capture normalized UI tree

The tool executes a serializer inside the page and returns a JSON-compatible tree rooted at `document.body`.

Each included node contains a controlled subset of DOM, layout, style, and accessibility information.

---

## 10. Normalized UI Tree

### 10.1 Design principles

The tree should:

* Describe the rendered interface
* Remain stable across framework migrations
* Exclude framework-specific implementation details
* Retain enough information to diagnose visual differences
* Be reasonably compact
* Preserve parent-child hierarchy

The tool must not compare raw `outerHTML`.

### 10.2 Element schema

```ts
interface UiNode {
  nodeId: string;
  tag: string;
  role?: string;
  accessibleName?: string;

  text?: string;
  directText?: string;

  attributes?: Record<string, string>;
  classes?: string[];

  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  style?: {
    display?: string;
    position?: string;
    visibility?: string;
    opacity?: string;

    color?: string;
    backgroundColor?: string;

    fontFamily?: string;
    fontSize?: string;
    fontWeight?: string;
    lineHeight?: string;
    textAlign?: string;

    marginTop?: string;
    marginRight?: string;
    marginBottom?: string;
    marginLeft?: string;

    paddingTop?: string;
    paddingRight?: string;
    paddingBottom?: string;
    paddingLeft?: string;

    borderTopWidth?: string;
    borderRightWidth?: string;
    borderBottomWidth?: string;
    borderLeftWidth?: string;

    borderRadius?: string;
  };

  state?: {
    visible: boolean;
    disabled?: boolean;
    checked?: boolean;
    selected?: boolean;
    expanded?: boolean;
  };

  children: UiNode[];
}
```

### 10.3 Included nodes

By default, include:

* Visible elements
* Elements that affect visible layout
* Form controls
* Images
* SVG root elements
* Text-bearing elements
* Interactive elements
* Hidden elements with accessibility significance, when configured

Exclude by default:

* `script`
* `style`
* `link`
* `meta`
* `noscript`
* Browser extension injections
* Elements matching ignored selectors
* Empty elements with zero dimensions and no semantic role
* Comments
* Whitespace-only text nodes

### 10.4 Normalization rules

The serializer should:

* Convert tag names to lowercase
* Collapse repeated whitespace
* Trim text
* Normalize non-breaking spaces
* Round geometry to whole pixels
* Normalize colors to a consistent representation
* Remove ignored attributes
* Sort retained attribute keys
* Remove generated class names when configured
* Exclude pseudo-random framework identifiers
* Limit long text values to a configurable maximum
* Replace dynamic values using configured normalization patterns

Example text normalization:

```yaml
normalize:
  text:
    - pattern: "\\b\\d{1,2}:\\d{2}(:\\d{2})?\\b"
      replacement: "<TIME>"

    - pattern: "Order #[A-Z0-9-]+"
      replacement: "Order <ID>"
```

### 10.5 Retained attributes

The default retained attributes are:

* `alt`
* `aria-*`
* `title`
* `href`
* `src`
* `type`
* `name`
* `placeholder`
* `value`, except for sensitive input types
* `checked`
* `disabled`
* `selected`
* `open`
* `data-testid`
* `data-test`
* `data-sameframe-key`

Raw IDs are excluded by default because generated IDs frequently change during migrations.

### 10.6 Sensitive values

The tool must never capture:

* Password field values
* Credit-card field values
* Authentication tokens
* Cookie values
* Local-storage contents, unless explicitly requested
* Headers containing authorization credentials

Text redaction patterns should be configurable.

---

## 11. Element Identity and Matching

Comparing nodes by tree index alone is too fragile. The tool assigns each node a matching signature.

### 11.1 Strong matching signals

In priority order:

1. `data-sameframe-key`
2. Stable testing identifier
3. Accessible role and accessible name
4. Form name, type, and label
5. Stable `href` or image `src`
6. Element text
7. Tag, classes, and approximate position
8. Parent and sibling context

### 11.2 Matching process

For each reference node:

1. Search candidate nodes under the matched parent.
2. Score possible matches.
3. Select the highest score above the minimum threshold.
4. Mark the pair as matched.
5. Continue recursively.
6. Run a secondary global matching pass for nodes moved to different parents.

The matching score should favor semantic equivalence over exact DOM position.

Example:

A reference `<button>` and candidate `<a role="button">` may be considered equivalent when they have the same accessible name and similar geometry.

### 11.3 Stable key escape hatch

Teams can add a stable key to important components:

```html
<section data-sameframe-key="pricing-comparison">
```

This attribute is intended only to improve matching. The two sites do not need identical DOM structures beneath the keyed element.

---

## 12. Comparison Dimensions

The MVP generates four categories of results.

### 12.1 Screenshot comparison

Compare the masked screenshots using pixel difference.

Output:

* Changed-pixel percentage
* Diff image
* Highlighted changed regions
* Bounding boxes around clusters of changed pixels

To reduce noise:

* Apply a small antialiasing tolerance
* Ignore masked regions
* Ignore fully transparent pixels
* Allow configurable per-channel color tolerance
* Group neighboring changed pixels into regions

The screenshot result is a signal, not the sole pass/fail criterion.

### 12.2 Content comparison

Detect:

* Missing text
* Additional text
* Changed text
* Missing images
* Changed image sources
* Missing form controls
* Changed labels
* Changed links

Text comparison should distinguish:

* Exact match
* Normalized match
* Minor mismatch
* Material mismatch

### 12.3 Structural comparison

Detect:

* Missing element
* Additional element
* Changed semantic role
* Changed element type
* Reparented element
* Changed sibling order
* Collapsed or expanded sections
* Different heading hierarchy

DOM differences that do not change semantics should receive low severity.

Example:

```html
<div class="button">Continue</div>
```

versus:

```html
<button>Continue</button>
```

This is structurally different and potentially significant, even if the screenshot is identical.

### 12.4 Layout and style comparison

For matched visible elements, compare:

* Position
* Width and height
* Visibility
* Typography
* Foreground and background colors
* Margin and padding
* Border dimensions
* Border radius

Only selected computed properties are compared.

Values within configured tolerances are treated as equivalent.

---

## 13. Severity Model

Every difference receives:

* Category
* Severity
* Confidence
* Reference node
* Candidate node
* Supporting evidence
* Screenshot region, when available

### Critical

Examples:

* Candidate page fails to load
* Main content root is absent
* Large visible section is missing
* Authentication or runtime error blocks rendering
* Page is substantially blank
* Screenshot dimensions are unexpectedly truncated

### High

Examples:

* Primary heading missing
* Navigation item missing
* Major component absent
* Important CTA missing
* Large layout displacement
* Material text mismatch
* Image missing
* Form field or label missing

### Medium

Examples:

* Typography differs materially
* Component dimensions differ
* Element order changes
* Secondary text changes
* Color or spacing differs noticeably

### Low

Examples:

* Small pixel differences
* Minor rounding differences
* Slight text wrapping changes
* Non-semantic wrapper differences
* Differences below user-facing significance thresholds

---

## 14. Page Score

Each route and viewport receives a parity score from 0 to 100.

Suggested initial weighting:

* Screenshot similarity: 40%
* Content similarity: 25%
* Layout similarity: 20%
* Structural and semantic similarity: 15%

The report must also show the underlying metrics. A single score must not conceal critical failures.

Example:

```json
{
  "score": 93.4,
  "status": "review",
  "metrics": {
    "screenshotSimilarity": 0.964,
    "contentSimilarity": 0.992,
    "layoutSimilarity": 0.918,
    "structureSimilarity": 0.901
  },
  "criticalDifferences": 0,
  "highDifferences": 2,
  "mediumDifferences": 7,
  "lowDifferences": 19
}
```

### Status rules

* `pass`: score meets threshold and no critical or high-severity differences exist
* `review`: no critical failure, but thresholds or high-severity checks fail
* `fail`: capture failure or critical difference exists

Default thresholds:

```yaml
status:
  passScore: 95
  reviewScore: 80
```

---

## 15. Output Artifacts

The tool creates an output directory:

```text
sameframe-results/
  run.json
  report.html

  home/
    desktop/
      reference.tree.json
      candidate.tree.json
      reference.full.png
      candidate.full.png
      screenshot-diff.png
      comparison.json

    mobile/
      ...

  pricing/
    ...
```

### 15.1 Machine-readable result

`run.json` contains:

* Tool version
* Configuration hash
* Execution timestamp
* Browser version
* Route results
* Aggregate counts
* Errors
* Exit status

`comparison.json` contains the detailed element-level differences for one route and viewport.

### 15.2 HTML report

The HTML report includes:

* Run summary
* Route and viewport filters
* Pass, review, and fail counts
* Side-by-side screenshots
* Screenshot diff overlay
* Difference list ordered by severity
* Element bounding-box overlays
* Reference and candidate node details
* Search and category filters
* Links to raw JSON artifacts

The report should be static and viewable without a server.

### 15.3 Console output

Example:

```text
UI Parity Validator

PASS    /                    desktop    98.2
REVIEW  /                    mobile     91.7
FAIL    /pricing             desktop    72.1
PASS    /products/widget     desktop    96.4

2 passed, 1 review, 1 failed

Report: sameframe-results/report.html
```

---

## 16. CLI Interface

Proposed package name:

```text
sameframe
```

Run a comparison:

```bash
npx sameframe compare --config sameframe.config.yaml
```

Useful options:

```bash
npx sameframe compare \
  --config sameframe.config.yaml \
  --route /pricing \
  --viewport desktop \
  --output ./artifacts/sameframe
```

Additional commands:

```bash
npx sameframe validate-config
npx sameframe capture --target reference
npx sameframe capture --target candidate
```

The `compare` command is the only command required for the first usable release. The others may be thin conveniences.

---

## 17. CI Behavior

The command exits with:

* `0`: all comparisons pass
* `1`: one or more comparisons fail
* `2`: invalid configuration or execution error

By default, `review` results do not fail CI.

Configuration:

```yaml
ci:
  failOn:
    - fail
  maxHighSeverityDifferences: 0
```

A stricter project can fail on review:

```yaml
ci:
  failOn:
    - review
    - fail
```

CI should retain the HTML report, screenshots, and JSON files as build artifacts.

---

## 18. Configuration Escape Hatches

Migration projects contain unavoidable dynamic regions. The MVP must support explicit controls.

### Ignore an element entirely

```yaml
ignore:
  selectors:
    - ".live-stock-price"
```

### Mask screenshot but retain tree comparison

```yaml
screenshot:
  maskSelectors:
    - ".user-avatar"
```

### Ignore one style property

```yaml
ignore:
  styleProperties:
    - font-family
```

### Ignore a property for selected elements

```yaml
rules:
  - selector: ".promo-card"
    ignore:
      styleProperties:
        - background-color
```

### Use stable element keys

```html
<div data-sameframe-key="account-summary">
```

### Route-specific preparation

```yaml
routes:
  - path: /dashboard
    prepare: ./scripts/prepare-dashboard.ts
```

### Route mapping

The same page may use different routes after migration:

```yaml
routes:
  - name: Product detail
    referencePath: /catalog/widget-1
    candidatePath: /products/widget-1
```

---

## 19. Error Handling

The tool must distinguish comparison failures from capture failures.

Capture errors include:

* Navigation timeout
* HTTP failure
* Page crash
* Authentication failure
* Setup-script failure
* Screenshot failure
* Serializer failure
* Browser launch failure

A capture error creates:

* A failed route result
* Error details
* Console and network diagnostics
* Any partial screenshot available

One route failure should not stop the remaining routes unless `failFast` is enabled.

---

## 20. Performance Targets

For the MVP:

* Support at least 50 route-viewport combinations per run
* Process combinations sequentially by default
* Support configurable concurrency
* Keep UI-tree JSON below approximately 5 MB for a typical page
* Complete capture and comparison of a typical page in under 15 seconds, excluding unusually slow page loads

Performance is secondary to determinism and useful diagnostics.

---

## 21. Technical Architecture

### Main modules

```text
src/
  config/
    load-config.ts
    schema.ts

  browser/
    browser-manager.ts
    navigation.ts
    stabilization.ts
    preparation.ts

  capture/
    capture-page.ts
    serialize-ui-tree.ts
    screenshot.ts
    diagnostics.ts

  compare/
    match-nodes.ts
    compare-content.ts
    compare-layout.ts
    compare-style.ts
    compare-structure.ts
    compare-screenshots.ts
    score.ts

  report/
    build-json-report.ts
    build-html-report.ts

  cli/
    compare-command.ts
```

### Recommended dependencies

* Playwright for browser automation
* Zod or equivalent for configuration validation
* Pixelmatch or equivalent for basic image comparison
* PNGJS or Sharp for image processing
* A string-similarity implementation for normalized text matching
* A static HTML renderer for the report

### Execution flow

```text
Load configuration
    ↓
Validate configuration
    ↓
Launch Playwright
    ↓
For each route and viewport:
    Capture reference
    Capture candidate
    Match UI-tree nodes
    Compare content, structure, layout, and style
    Compare screenshots
    Calculate score and status
    Write route artifacts
    ↓
Build aggregate JSON
    ↓
Build static HTML report
    ↓
Return CI exit code
```

---

## 22. Screenshot Comparison Strategy

The MVP should use a conventional pixel diff rather than machine-learning-based visual similarity.

Process:

1. Ensure images have matching canvas dimensions.
2. Pad smaller images when page heights differ.
3. Apply configured masks.
4. Run pixel comparison.
5. Calculate changed-pixel percentage.
6. Cluster changed pixels into regions.
7. Cross-reference changed regions with matched UI nodes.

A screenshot difference becomes more actionable when linked to elements.

Example:

```json
{
  "category": "visual",
  "severity": "high",
  "message": "Pricing card is 64px taller in the candidate",
  "referenceNodeId": "ref-183",
  "candidateNodeId": "cand-201",
  "region": {
    "x": 88,
    "y": 514,
    "width": 376,
    "height": 492
  }
}
```

---

## 23. Layout Stability Strategy

A page is considered stable when two successive samples have approximately equal:

* Document width and height
* Number of visible elements
* Bounding boxes of selected anchor elements

Suggested sampling interval:

```text
100 ms
```

Suggested requirement:

```text
Three matching samples or a maximum stabilization timeout
```

The maximum stabilization timeout should be configurable and default to five seconds.

---

## 24. Acceptance Criteria

The MVP is valuable when it satisfies all of the following.

### Capture

* Captures reference and candidate screenshots for every configured route and viewport
* Captures normalized hierarchical UI trees
* Records browser and page errors
* Supports authenticated pages through storage state
* Supports ignored and masked selectors

### Comparison

* Detects an element removed from the candidate
* Detects additional candidate content
* Detects changed visible text
* Detects material position and size differences
* Detects selected computed-style differences
* Detects screenshot differences
* Tolerates non-semantic wrapper changes
* Tolerates configured pixel and geometry thresholds

### Reporting

* Produces a static HTML report
* Provides side-by-side screenshots and a diff image
* Lists differences by severity
* Connects element-level differences to screenshot regions
* Produces structured JSON
* Returns a deterministic CI exit code

### Reliability

* One route failure does not stop the complete run
* Dynamic content can be ignored or normalized
* Repeated runs against an unchanged site produce substantially identical results

---

## 25. MVP Validation Scenarios

The initial test suite should include controlled fixture pages representing these cases:

1. Exact page match
2. Different framework, equivalent rendered UI
3. Missing CTA
4. Changed heading text
5. Different font size
6. Four-pixel spacing difference
7. Large component displacement
8. Additional wrapper elements
9. Reordered navigation items
10. Dynamic timestamp ignored through normalization
11. Cookie banner hidden through preparation script
12. Image source changed but image dimensions preserved
13. Mobile-only regression
14. Candidate runtime exception
15. Shadow DOM component

These fixtures establish whether the tool detects meaningful differences without over-reporting implementation changes.

---

## 26. Product Risks

### False positives from nondeterministic content

Mitigation:

* Masks
* Text normalization
* Preparation scripts
* Deterministic locale and timezone
* Third-party request blocking

### False positives from font rendering

Mitigation:

* Use the same browser and operating environment
* Wait for font loading
* Support screenshot tolerance
* Report typography differences separately

### Poor node matching after substantial restructuring

Mitigation:

* Semantic matching
* Stable parity keys
* Secondary global matching
* Parent-context scoring

### Large reports with excessive noise

Mitigation:

* Severity ranking
* Difference grouping
* Collapsing low-severity findings
* Thresholds
* Component-level summaries

### Pixel-perfect score hiding semantic defects

Mitigation:

* Separate structural and content checks
* Never allow the aggregate score to override critical findings

---

## 27. Deferred Features

Candidates for later versions:

* Interactive Chrome extension
* Hosted comparison dashboard
* Pull-request comments
* GitHub Actions integration package
* Baseline approval workflow
* Historical trend tracking
* Component-level ownership
* Storybook comparison
* Multi-step user journeys
* Accessibility-tree comparison
* OCR for canvas-rendered text
* Visual embeddings or perceptual similarity
* Automatic grouping into reusable components
* Cross-browser comparison
* Safari and Firefox support
* Video and animation comparison
* Automatic remediation suggestions
* AI-generated difference summaries
* Integration with design files
* Remote worker pool

---

## 28. Recommended First Release Boundary

The first releasable version should contain only:

* A Node.js CLI
* Playwright Chromium capture
* YAML or JSON configuration
* Route and viewport iteration
* Normalized UI-tree serialization
* Basic semantic node matching
* Content, geometry, selected-style, and pixel comparison
* Ignore selectors and screenshot masks
* Static HTML and JSON reports
* CI exit codes

Authentication may be supported through pre-generated Playwright storage state rather than a built-in login recorder.

This boundary keeps the implementation focused while still producing a tool that can be used on a real migration project.

---

## 29. Success Metrics

For a real migration test set:

* At least 90% of intentionally introduced UI regressions are detected
* Fewer than 20% of reported high-severity findings are false positives
* An engineer can identify the likely source of a regression from the report without manually inspecting both DOM trees
* Repeated unchanged runs vary by less than one percentage point in parity score
* The tool reduces manual page-comparison time by at least 50%

---

## 30. Definition of Done

The MVP is complete when an engineer can run:

```bash
npx sameframe compare --config sameframe.config.yaml
```

and receive:

* A pass, review, or fail result for every page and viewport
* Side-by-side screenshots
* A visual diff
* A normalized UI-tree comparison
* Prioritized explanations of material differences
* A static report suitable for CI artifacts
* A non-zero exit code when configured parity requirements are not met


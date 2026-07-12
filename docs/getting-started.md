# Getting started

> Complete one deterministic page comparison and confirm that its persisted evidence is available for inspection.

## Prerequisites

Sameframe requires Node.js and the Chromium build pinned by its Playwright dependency. Install both the package and browser:

```bash
pnpm add -D sameframe
pnpm exec playwright install chromium
```

On Linux CI runners, install the browser and required system libraries together:

```bash
pnpm exec playwright install --with-deps chromium
```

## Compare one page

Pass complete reference and candidate URLs, a viewport, and an output directory:

```bash
pnpm exec sameframe compare \
  --reference https://legacy.example.com/pricing \
  --candidate http://localhost:3000/pricing \
  --viewport 1440x900 \
  --output ./artifacts/pricing \
  --json > ./artifacts/pricing-result.json
```

With `--json`, stdout contains only the versioned result. Logs and errors go to stderr, so redirecting stdout produces valid JSON.

Check the status and assertions:

```bash
node -e '
const result = require("./artifacts/pricing-result.json")
console.log(result.status, result.assertions)
'
```

`pass` means no critical or high findings, healthy runtime diagnostics, and configured layout and screenshot thresholds were met. `review` means persisted evidence needs inspection. `fail` means a high-value parity assertion failed.

## Inspect the first finding

Use the `pageId` and a finding ID from the result:

```bash
pnpm exec sameframe inspect-finding \
  --page-id pricing--1440x900 \
  --finding-id finding-1 \
  --output ./artifacts/pricing
```

The command reads the existing evidence bundle. It does not launch Chromium or recapture either page.

Next, follow [Inspect and verify](guides/inspect-and-verify.md) to locate a candidate node and recompare only the repaired region. Use [Configure comparisons](guides/configure-comparisons.md) when more than one route or viewport must be checked.

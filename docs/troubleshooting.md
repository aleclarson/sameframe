# Troubleshooting

> Start from a failed command or suspicious result, verify the relevant capture evidence, and apply the smallest corrective action.

## Chromium executable does not exist

Symptom:

```text
browserType.launch: Executable doesn't exist
```

The Playwright package is installed, but its pinned browser binary is not. Install it locally:

```bash
pnpm exec playwright install chromium
```

On a Linux CI runner, also install required system libraries:

```bash
pnpm exec playwright install --with-deps chromium
```

## Capture returns `error`

Inspect both page records before evaluating parity:

```bash
pnpm exec sameframe inspect-page \
  --page-id pricing--1440x900 \
  --format comparison \
  --output ./artifacts
```

Check requested and final URLs, navigation status, runtime diagnostics, stabilization, and setup failures. A missing required stylesheet or script is critical because the rendered page is not trustworthy.

## Page never stabilizes

Verify whether the page continuously changes layout or merely needs more time. Increase the timeout only when the page reaches a stable state predictably:

```yaml
capture:
  stabilizationTimeoutMs: 10000
```

For clocks, rotating content, or personalized regions, use a targeted ignore, mask, or text normalization rule instead of increasing the timeout indefinitely.

## Managed authentication is missing or belongs to another origin

Create or replace the target profile through visible Chromium:

```bash
pnpm exec sameframe auth login \
  --config ./sameframe.yaml \
  --target candidate \
  --force
```

Sameframe records the configured origin as safety metadata. An origin change requires a new login even though origin is not part of the repository-scoped storage key.

## Expected dynamic content creates findings

Use [Configure comparisons](guides/configure-comparisons.md) to choose among:

- `ignore.selectors` when neither structure nor pixels should be compared;
- `screenshot.maskSelectors` when structure should still be compared;
- `normalize.text` when the text's shape matters but its dynamic value does not.

After changing a rule, inspect capture metadata to confirm the effective controls were recorded.

## Inspection cannot find the page ID

Inspection searches `./artifacts` by default. Point it at the artifact root used during comparison:

```bash
pnpm exec sameframe inspect-page \
  --page-id pricing--1440x900 \
  --format summary \
  --output ./artifacts/pricing
```

If multiple runs under that directory share a page ID, narrow `--output` to one run.

## A comparison returns `review`

`review` is not a pass or failure inferred from a similarity score. Inspect medium findings, uncertain match alternatives, and screenshot-only regions:

```bash
pnpm exec sameframe inspect-page \
  --page-id pricing--1440x900 \
  --format findings \
  --output ./artifacts
```

Use [Inspect and verify](guides/inspect-and-verify.md) to retrieve the relevant node or finding bundle before changing candidate code.

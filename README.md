# sameframe

Sameframe is a deterministic, agent-facing CLI for finding meaningful UI differences between a reference website and a migrated candidate.

## Install

```bash
pnpm add -D sameframe
pnpm exec playwright install chromium
```

## Compare

```bash
sameframe compare \
  --reference https://legacy.example.com/pricing \
  --candidate http://localhost:3000/pricing \
  --viewport 1440x900 \
  --output ./artifacts/pricing \
  --json
```

The compact result reports `pass`, `review`, `fail`, or `error` and links to persisted screenshots, normalized UI trees, matches, findings, diagnostics, and evidence crops. JSON mode writes only JSON to stdout.

Use YAML or JSON configuration for route and viewport matrices:

```yaml
reference:
  baseUrl: https://legacy.example.com
candidate:
  baseUrl: http://localhost:3000
routes:
  - path: /pricing
  - referencePath: /catalog/widget
    candidatePath: /products/widget
viewports:
  - width: 1440
    height: 900
output: ./artifacts
```

Run it with `sameframe compare --config sameframe.yaml --json`. Configuration also supports storage-state files, a trusted per-page ESM `setupScript`, ignored selectors, screenshot masks, text replacements, capture controls, and geometry/screenshot thresholds.

## Inspect and verify

```bash
sameframe inspect-finding --page-id pricing--1440x900 --finding-id finding-1 --output ./artifacts
sameframe inspect-node --page-id pricing--1440x900 --target candidate --node-id cand-42 --output ./artifacts
sameframe query-tree --page-id pricing--1440x900 --target candidate --text "Start free trial" --output ./artifacts
```

After a fix, pass `--selector '[data-sameframe-key="pricing-grid"]'` to compare only the affected stable region. See the bundled [`sameframe` agent skill](skills/sameframe/SKILL.md) for the complete agent workflow and canonical JSON schemas.

Exit codes are `0` pass, `1` parity failure, `2` invalid configuration, `3` incomplete capture/comparison, and `4` internal failure.

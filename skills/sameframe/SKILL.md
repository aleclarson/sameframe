---
name: sameframe
description: Compare a reference website with a migrated candidate using the Sameframe CLI, inspect structured UI parity findings and persisted browser evidence, trace regressions to captured nodes or source metadata, and narrowly verify fixes. Use for frontend migrations, visual or structural parity checks, deterministic browser comparisons, and CI parity failures produced by Sameframe.
---

# Sameframe

Use the CLI as an evidence loop: compare, inspect the smallest useful artifact, fix the candidate, then recompare the affected region.

## Compare

Run a direct comparison:

```bash
sameframe compare \
  --reference https://legacy.example.com/pricing \
  --candidate http://localhost:3000/pricing \
  --viewport 1440x900 \
  --output ./artifacts/pricing \
  --json
```

Use `--config sameframe.yaml` for route and viewport matrices. Treat exit `0` as pass, `1` as a parity failure, `2` as invalid input, `3` as incomplete capture, and `4` as an internal failure. When requesting JSON, parse stdout only; diagnostics belong on stderr.

For a target with `authProfile`, instruct the human to run `sameframe auth login --config sameframe.yaml --target reference|candidate`. Do not attempt to complete an interactive login for them. Managed state stays in the OS application-data directory and is scoped by Git repository, configuration namespace, target, and profile. Use explicit `storageState` paths for CI-injected credentials.

## Inspect evidence

Start from finding summaries. Do not open full screenshots or trees unless a finding lacks enough context.

```bash
sameframe inspect-finding --page-id pricing--1440x900 --finding-id finding-2 --output ./artifacts/pricing
sameframe inspect-node --page-id pricing--1440x900 --target candidate --node-id cand-42 --output ./artifacts/pricing
sameframe get-subtree --page-id pricing--1440x900 --target candidate --node-id cand-42 --depth 3 --output ./artifacts/pricing
```

Use `inspect-page --format summary|artifacts|comparison|tree|matches|findings` for page-level context. Use `query-tree` with one or more of `--node-id`, `--text`, `--role`, `--tag`, `--selector`, `--test-id`, `--parity-key`, `--source-file`, or `--region x,y,width,height` to locate evidence.

Treat findings as facts, not diagnoses. Respect match confidence and inspect alternatives when a match is uncertain. Prefer candidate `source` metadata when present, then search the candidate repository using the captured text, role, parity key, or test identifier.

## Verify a fix

Recompare the smallest stable region after editing:

```bash
sameframe compare \
  --reference https://legacy.example.com/pricing \
  --candidate http://localhost:3000/pricing \
  --selector '[data-sameframe-key="pricing-grid"]' \
  --output ./artifacts/pricing-grid \
  --json
```

Accept restoration only when the structured result passes. If it returns review, inspect uncertain matches and screenshot-only changes before concluding parity.

## JSON contracts

Read the versioned schemas in `schemas/` when generating integrations or validating artifacts. `comparison-result.schema.json` defines a single compact result, `comparison-batch.schema.json` defines matrix output, and `inspection-result.schema.json` defines inspection envelopes. The other schemas define authoritative page, tree, match, and finding artifacts. Do not infer fields absent from those contracts.

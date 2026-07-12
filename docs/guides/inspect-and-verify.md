# Inspect and verify

> Move from a compact finding to the smallest useful persisted evidence, then verify the fix with a region-scoped comparison.

## Start with the finding

Retrieve its values, node IDs, source metadata, suggested action, and evidence files:

```bash
pnpm exec sameframe inspect-finding \
  --page-id pricing--1440x900 \
  --finding-id finding-12 \
  --output ./artifacts
```

Finding bundles may contain reference and candidate crops plus the relevant subtrees. Use those before opening full-page artifacts.

## Inspect the candidate node

When the finding includes `candidateNodeId`, retrieve its parent, children, ancestors, nearby siblings, full captured computed styles, source metadata, and screenshot crop:

```bash
pnpm exec sameframe inspect-node \
  --page-id pricing--1440x900 \
  --target candidate \
  --node-id cand-201 \
  --output ./artifacts
```

If source metadata is absent, query the captured tree using a stable UI signal:

```bash
pnpm exec sameframe query-tree \
  --page-id pricing--1440x900 \
  --target candidate \
  --text "Start free trial" \
  --output ./artifacts
```

Queries can combine node ID, text, role, tag, selector, test ID, parity key, source file, and screenshot region. Combined filters use AND semantics.

Retrieve a bounded subtree when hierarchy is relevant:

```bash
pnpm exec sameframe get-subtree \
  --page-id pricing--1440x900 \
  --target candidate \
  --node-id cand-201 \
  --depth 3 \
  --output ./artifacts
```

## Recompare the repaired region

Choose a stable selector owned by the application, preferably `data-sameframe-key`:

```bash
pnpm exec sameframe compare \
  --reference https://legacy.example.com/pricing \
  --candidate http://localhost:3000/pricing \
  --selector '[data-sameframe-key="pricing-grid"]' \
  --output ./artifacts/pricing-grid \
  --json
```

The scoped capture serializes and screenshots the selected element instead of the full document. Treat parity as restored only when the structured result passes. If it returns `review`, inspect uncertain matches and screenshot-only findings before deciding what to change next.

For the meaning of confidence, severity, assertions, and status, see [Evidence and results](../concepts/evidence-and-results.md).

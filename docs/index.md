# Sameframe

> Compare a migrated page with its reference, inspect durable evidence, and verify a focused fix without manually browsing both versions.

Sameframe is a deterministic command-line tool for AI coding agents. It captures a reference and candidate page in pinned Playwright Chromium environments, compares their rendered UI, and persists the evidence behind every finding.

```bash
sameframe compare \
  --reference https://legacy.example.com/pricing \
  --candidate http://localhost:3000/pricing \
  --viewport 1440x900 \
  --output ./artifacts/pricing \
  --json
```

The command writes a compact JSON result to stdout and detailed artifacts beneath `./artifacts/pricing`. A coding agent can inspect one finding or node from those artifacts without capturing the page again.

## Start here

- [Getting started](getting-started.md) — install Chromium and complete one comparison.
- [Configure comparisons](guides/configure-comparisons.md) — compare route and viewport matrices while controlling expected noise.
- [Inspect and verify](guides/inspect-and-verify.md) — move from a finding to source context and a narrow rerun.
- [Evidence and results](concepts/evidence-and-results.md) — understand captures, matches, findings, assertions, and statuses.

## Look up details

- [Command reference](reference/commands.md)
- [Configuration reference](reference/configuration.md)
- [Troubleshooting](troubleshooting.md)

> [!IMPORTANT]
> Sameframe reports observable differences and deterministic next actions. It does not diagnose causes, edit source code, or decide that a visual difference is acceptable.

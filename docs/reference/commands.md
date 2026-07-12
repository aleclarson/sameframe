# Command reference

> Look up Sameframe command inputs, persisted side effects, output shapes, and failure behavior without reconstructing syntax from examples.

## `compare`

Capture and compare one URL pair or a configuration matrix.

```text
sameframe compare --reference <url> --candidate <url> --output <dir>
                  [--viewport <width>x<height>] [--selector <css>] [--json]
sameframe compare --config <yaml-or-json> [--selector <css>] [--json]
```

| Option              | Required    | Default     | Purpose                                               |
| ------------------- | ----------- | ----------- | ----------------------------------------------------- |
| `--reference <url>` | Direct mode | —           | Complete reference page URL.                          |
| `--candidate <url>` | Direct mode | —           | Complete candidate page URL.                          |
| `--output <dir>`    | Direct mode | —           | Artifact root for this comparison.                    |
| `--config <path>`   | Config mode | —           | YAML or JSON matrix configuration.                    |
| `--viewport <WxH>`  | No          | `1440x900`  | Direct-mode viewport.                                 |
| `--selector <css>`  | No          | Full page   | Capture and compare one matched region on both pages. |
| `--json`            | No          | Pretty JSON | Emit compact JSON without indentation.                |

Direct mode writes page artifacts directly beneath the output directory. Config mode creates route and viewport subdirectories. Matrix output uses the versioned comparison-batch schema.

## `inspect-page`

```text
sameframe inspect-page --page-id <id> [--format <format>] [--output <dir>]
```

Formats are `summary`, `artifacts`, `comparison`, `tree`, `matches`, and `findings`. The default is `summary`.

## `inspect-node`

```text
sameframe inspect-node --page-id <id> --target <reference|candidate>
                       --node-id <id> [--output <dir>]
```

Returns the node, parent, children, ancestors, nearby siblings, captured computed styles, source metadata, and a generated crop path.

## `query-tree`

```text
sameframe query-tree --page-id <id> --target <reference|candidate>
  [--node-id <id>] [--text <value>] [--role <role>] [--tag <tag>]
  [--selector <css>] [--test-id <id>] [--parity-key <key>]
  [--source-file <path>] [--region <x,y,width,height>] [--output <dir>]
```

Multiple filters must all match. Text matching is case-insensitive and searches visible and accessible text. Region matching returns nodes whose bounds intersect the requested rectangle.

## `get-subtree`

```text
sameframe get-subtree --page-id <id> --target <reference|candidate>
                      --node-id <id> [--depth <number>] [--output <dir>]
```

The default depth is `3`. Depth `0` returns only the requested node.

## `inspect-finding`

```text
sameframe inspect-finding --page-id <id> --finding-id <id> [--output <dir>]
```

Returns the finding and paths within its persisted evidence bundle.

## `auth login`

```text
sameframe auth login --config <path> --target <reference|candidate>
                     [--login-url <url>] [--force] [--no-indexed-db]
```

Opens visible Chromium for a human to authenticate, then saves managed browser state outside the repository. The configured target requires `authProfile`.

## `auth list`

```text
sameframe auth list
```

Lists namespace, target, profile, origin, and creation time for the current Git repository. Credential values are never displayed.

## `auth remove`

```text
sameframe auth remove --config <path> --target <reference|candidate>
```

Deletes the configured managed state and its credential-free metadata.

## Artifact lookup

Inspection commands search `./artifacts` unless `--output` is provided. They recursively locate `comparison/result.json` with the requested page ID. If more than one artifact set has that ID, pass a narrower output directory.

## Exit codes

| Code | Meaning                                    |
| ---- | ------------------------------------------ |
| `0`  | Comparison passed or inspection succeeded. |
| `1`  | Parity failure.                            |
| `2`  | Invalid command or configuration.          |
| `3`  | Incomplete capture or comparison.          |
| `4`  | Internal tool failure.                     |

# Configuration reference

> Look up supported YAML and JSON fields, defaults, path resolution, and the exact kind of comparison noise each control changes.

## Minimal configuration

```yaml
reference:
  baseUrl: https://legacy.example.com
candidate:
  baseUrl: http://localhost:3000
routes:
  - path: /pricing
output: ./artifacts
```

Relative `output`, storage-state, and setup-script paths resolve from the configuration file's directory.

## Top-level fields

| Field         | Type       | Required               | Default                                                |
| ------------- | ---------- | ---------------------- | ------------------------------------------------------ |
| `reference`   | target     | Yes                    | —                                                      |
| `candidate`   | target     | Yes                    | —                                                      |
| `auth`        | object     | No                     | Namespace derived from the configuration path.         |
| `routes`      | route[]    | Yes                    | —                                                      |
| `viewports`   | viewport[] | No                     | `[{ width: 1440, height: 900 }]`                       |
| `output`      | string     | No when loading a file | `./artifacts`                                          |
| `setupScript` | string     | No                     | —                                                      |
| `ignore`      | object     | No                     | No ignored selectors.                                  |
| `screenshot`  | object     | No                     | No masks; pixel threshold uses the comparison default. |
| `normalize`   | object     | No                     | No text replacements.                                  |
| `thresholds`  | object     | No                     | See comparison thresholds.                             |
| `capture`     | object     | No                     | See capture controls.                                  |

## Targets and routes

`reference` and `candidate` each require `baseUrl`. They may additionally select one authentication source:

| Field          | Purpose                                                                           |
| -------------- | --------------------------------------------------------------------------------- |
| `authProfile`  | Sameframe-managed state scoped to the repository, namespace, target, and profile. |
| `storageState` | Explicit Playwright state path for CI or externally managed credentials.          |

A target cannot set both fields. Profile and namespace names may contain letters, numbers, dots, underscores, and hyphens.

Set an optional stable namespace when the repository has more than one comparison effort:

```yaml
auth:
  namespace: pricing-migration
```

Each route uses either one shared path or an explicit mapping:

```yaml
routes:
  - path: /pricing
  - referencePath: /catalog/widget
    candidatePath: /products/widget
```

A mapping must provide both `referencePath` and `candidatePath`.

## Viewports

Each viewport requires positive integer dimensions:

```yaml
viewports:
  - width: 1440
    height: 900
  - width: 390
    height: 844
```

Sameframe uses device scale factor `1`; a viewport does not emulate a named mobile device.

## Noise controls

```yaml
ignore:
  selectors:
    - .timestamp

screenshot:
  maskSelectors:
    - .user-avatar

normalize:
  text:
    - pattern: 'Order #[A-Z0-9-]+'
      replacement: 'Order <ID>'
```

Text rules run in listed order as global JavaScript regular expressions. An invalid pattern makes the configuration invalid.

## Comparison thresholds

| Field                                 | Type   | Default | Effect                                                     |
| ------------------------------------- | ------ | ------- | ---------------------------------------------------------- |
| `thresholds.positionPx`               | number | `4`     | Maximum x/y movement without a layout finding.             |
| `thresholds.sizePx`                   | number | `4`     | Maximum width/height change without a layout finding.      |
| `thresholds.screenshotChangedPercent` | number | `0.1`   | Changed-pixel percentage allowed before a visual finding.  |
| `thresholds.highConfidence`           | number | `0.8`   | Minimum confidence for automatic node comparison.          |
| `thresholds.lowConfidence`            | number | `0.5`   | Minimum confidence for retaining an uncertain alternative. |

## Capture controls

| Field                            | Type   | Default       | Allowed values                                      |
| -------------------------------- | ------ | ------------- | --------------------------------------------------- |
| `capture.waitUntil`              | string | `networkidle` | `load`, `domcontentloaded`, `networkidle`, `commit` |
| `capture.stabilizationTimeoutMs` | number | `5000`        | Timeout in milliseconds.                            |
| `capture.locale`                 | string | `en-US`       | Browser locale accepted by Playwright.              |
| `capture.timezone`               | string | `UTC`         | Timezone ID accepted by Playwright.                 |

The timeout bounds navigation and the layout-stability wait. If dimensions do not settle before it expires, capture metadata records `stabilized: false`.

## Stable matching and source metadata

Application markup can provide the strongest matching key:

```html
<section data-sameframe-key="pricing-grid"></section>
```

Optional source attributes flow into nodes and findings:

```html
<div
  data-ui-source-file="src/components/PricingCard.tsx"
  data-ui-source-line="42"
  data-ui-source-column="3"
  data-ui-source-component="PricingCard"
></div>
```

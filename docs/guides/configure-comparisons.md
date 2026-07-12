# Configure comparisons

> Use a configuration file when routes, viewports, authentication, or noise controls must remain consistent across repeated comparisons.

## Compare a route matrix

Create `sameframe.yaml`:

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
  - width: 390
    height: 844

output: ./artifacts
```

Run every route at every viewport:

```bash
pnpm exec sameframe compare --config ./sameframe.yaml --json
```

Each matrix entry gets its own page ID and artifact directory. A capture failure in one entry does not prevent independent entries from running.

## Control dynamic content

Choose the narrowest control that describes the difference:

| Need                                         | Configuration                                | Effect                                                                |
| -------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| Exclude an element entirely                  | `ignore.selectors`                           | Removes it from the UI tree and masks it in screenshots.              |
| Preserve tree data but suppress pixels       | `screenshot.maskSelectors`                   | Masks only its screenshot region.                                     |
| Compare text after replacing a dynamic value | `normalize.text`                             | Applies ordered regular-expression replacements during serialization. |
| Allow small geometry drift                   | `thresholds.positionPx`, `thresholds.sizePx` | Suppresses layout findings within the configured pixel tolerance.     |

For timestamps that should not participate in either comparison:

```yaml
ignore:
  selectors:
    - .timestamp
    - '[data-sameframe-ignore]'
```

For text whose structure matters but whose value changes:

```yaml
normalize:
  text:
    - pattern: "\\b\\d{1,2}:\\d{2}\\b"
      replacement: '<TIME>'
```

> [!CAUTION]
> Broad selectors and replacement patterns can hide regressions. Prefer stable, product-owned selectors and patterns that match only the unavoidable dynamic value.

## Prepare authenticated pages

Use a Sameframe-managed profile for local human authentication:

```yaml
auth:
  namespace: pricing-migration
reference:
  baseUrl: https://legacy.example.com
  authProfile: migration-user
candidate:
  baseUrl: http://localhost:3000
  authProfile: migration-user
```

Then ask a human to run `sameframe auth login` for each target. See [Authenticate pages](authenticated-pages.md) for the complete workflow and OS storage locations. Use an explicit `storageState` path for CI-mounted credentials.

When storage state is insufficient, point `setupScript` to a trusted local ESM module:

```yaml
setupScript: ./sameframe.setup.mjs
```

```js
export default async function setup({ page, target }) {
  await page.addInitScript((value) => localStorage.setItem('sameframe-target', value), target)
  await page.reload()
}
```

Sameframe invokes the callback separately for the reference and candidate with `page`, `target`, route URLs, and viewport context. A callback failure becomes a critical setup diagnostic, and the script content hash is recorded in capture metadata.

See [Configuration reference](../reference/configuration.md) for every supported field and default.

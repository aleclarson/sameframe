# Authenticate pages

> Let a human sign in once, then reuse repository-scoped browser state without placing credentials in project files.

## Configure a managed profile

Name the migration effort and the account profile. The configuration contains identifiers, not credentials:

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

`auth.namespace` separates multiple Sameframe efforts in one Git repository. When omitted, Sameframe derives it from the configuration path relative to the repository root.

## Ask a human to sign in

Run the login command separately for each protected target:

```bash
pnpm exec sameframe auth login --config ./sameframe.yaml --target reference
pnpm exec sameframe auth login --config ./sameframe.yaml --target candidate
```

Sameframe opens visible Chromium. Complete authentication, return to the authenticated application, then press Enter in the terminal. Sameframe saves cookies, local storage, and IndexedDB with owner-only file permissions where supported.

Use a dedicated login page when the target base URL does not start the sign-in flow:

```bash
pnpm exec sameframe auth login \
  --config ./sameframe.yaml \
  --target candidate \
  --login-url http://localhost:3000/login
```

Pass `--force` to replace existing state. Pass `--no-indexed-db` only when the application does not keep authentication data there.

> [!WARNING]
> Managed state can impersonate the authenticated account. Sameframe stores it outside the repository and never prints its contents, but the file is not encrypted. Use a dedicated account with limited permissions.

## Where state lives

| Platform | Root                                                                  |
| -------- | --------------------------------------------------------------------- |
| macOS    | `~/Library/Application Support/sameframe/auth/`                       |
| Linux    | `$XDG_STATE_HOME/sameframe/auth/` or `~/.local/state/sameframe/auth/` |
| Windows  | `%LOCALAPPDATA%\sameframe\auth\`                                      |

Set `SAMEFRAME_HOME` to override the Sameframe application-data directory.

Within that root, identity is derived from the Git common directory, configuration namespace, target, and profile. Linked worktrees share the same repository identity. Origins are recorded as safety metadata but are not part of the storage key, so reused localhost ports cannot cause cross-project collisions.

If a configured origin changes, Sameframe refuses to apply the old state until a human replaces it with `auth login --force`.

## Inspect or remove profiles

```bash
pnpm exec sameframe auth list
pnpm exec sameframe auth remove --config ./sameframe.yaml --target candidate
```

`list` returns credential-free metadata for the current repository. `remove` deletes the configured state and its metadata.

## CI and externally managed state

Use an explicit Playwright storage-state path when CI injects credentials through a secret mount:

```yaml
candidate:
  baseUrl: https://preview.example.com
  storageState: /run/secrets/candidate-auth.json
```

`storageState` remains an advanced escape hatch. A target cannot configure both `storageState` and `authProfile`.

Playwright storage state does not preserve `sessionStorage` or passkeys. Applications that depend on those mechanisms require explicit setup code rather than a managed profile.

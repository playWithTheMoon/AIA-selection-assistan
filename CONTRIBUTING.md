# Contributing

Thanks for your interest in contributing to `AIA-selection-assistan`.

## Setup

Tested toolchain (see Known Issues below before upgrading):

- **Node.js 24 LTS** (24.19.0 verified) — Node 26 breaks electron's binary extraction
- **pnpm 10.x** (10.18.3 verified) — pnpm >= 11 ignores the `pnpm` field in package.json

```bash
pnpm install
pnpm dev
```

`pnpm install` needs **no C++ toolchain** — the vendored `third_party/selection-hook`
(see its `FORK.md`) ships a prebuilt Windows binary that installs by file copy.
You only need VS Build Tools + Python to *rebuild* that native module after
editing its C++ sources.

Switch Node versions with your usual version manager (nvm-windows / fnm / volta / Scoop —
all work; keep a reversible way to switch back if other projects need a different version).

## Validation

Before opening a pull request, please run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

## Pull Requests

- Keep changes focused and easy to review
- Update docs when behavior or configuration changes
- Include screenshots or short notes for visible UI changes when helpful
- Prefer small, incremental PRs over large mixed changes

## Issues

- Use bug reports for reproducible defects
- Use feature requests for product or UX ideas
- Include platform details when reporting runtime issues (`macOS` / `Windows`)

## Known Issues

### Node 26: electron binary silently fails to extract

**Symptom**: `pnpm install` (or `node node_modules/electron/install.js`) reports success
(exit 0, no warnings), but `node_modules/electron/dist/` contains only
`LICENSES.chromium.html` — no `electron.exe`, no `path.txt`. The app then fails to launch
(e.g. electron-vite's misleading `Error: Electron uninstall`).

**Root cause**: `extract-zip@2.0.1` (unmaintained since 2021, used by electron's npm
package ≤ 39.x) has an extraction regression on Node 26 — the async operation for larger
entries never settles, the event loop drains, and node exits silently mid-extract.
See [extract-zip#154](https://github.com/max-mapper/extract-zip/issues/154),
[electron#51619](https://github.com/electron/electron/issues/51619),
[electron#51623](https://github.com/electron/electron/issues/51623).
Electron fixed this in 40+ by switching to `@electron-internal/extract-zip`
([electron#51886](https://github.com/electron/electron/pull/51886)); this repo is still on
electron 33.x, which ships the broken extractor.

**Fix**: use Node 24 LTS (24.19.0 verified). Same cache zip, same command — extraction
completes. Do not reach for mirrors/proxies first: with Node 24 the download+extract works
over the normal network path.

### pnpm >= 11: build scripts silently blocked

**Symptom**: `pnpm install` ends with `ERR_PNPM_IGNORED_BUILDS` listing `electron`,
`esbuild`, `selection-hook`. Without these postinstall scripts the electron runtime binary
is never downloaded and the app cannot start.

**Root cause**: pnpm 11 removed support for the `"pnpm"` field in `package.json`
([pnpm 11 release notes](https://github.com/pnpm/pnpm/releases/tag/v11.0.0), #10086) —
the whitelist this repo declares there (`pnpm.onlyBuiltDependencies`) is silently ignored,
and pnpm 11+ then refuses to run undeclared build scripts by default.

**Fix**: use pnpm 10.x (10.18.3 verified), which still reads the `"pnpm"` field. If you
must use pnpm >= 11, migrate the whitelist to `pnpm-workspace.yaml` (as `allowBuilds` /
`onlyBuiltDependencies`) — that migration is deliberate future work, not a drive-by fix.

### Dev instance exits silently if the packaged app is running

**Symptom**: `pnpm dev` builds fine and prints `DevTools listening on ws://...`, then the
whole dev stack (electron + electron-vite) exits within seconds — no error, no stack trace.

**Root cause**: the dev build and the packaged app share the same `userData` directory
(`%APPDATA%/selection-assistant-lite`, derived from `package.json` `name`). Electron's
single-instance lock (`requestSingleInstanceLock()`) is keyed on that path, so the dev
instance fails to acquire the lock and quits gracefully — hence no error output.
electron-vite exits with it.

**Fix**: quit the packaged app before running `pnpm dev`.

**Alternative (not implemented)**: give the dev build its own `userData` directory
(`app.setPath('userData', ...)` in dev) — also isolates dev testing from the packaged
app's real settings data.

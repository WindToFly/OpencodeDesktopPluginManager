# OpenCode Ecosystem Manager

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A single control plane for the OpenCode plugin ecosystem. Browse the catalogued
community plugins, check V1/V2 compatibility and npm availability, and toggle
installs without editing `opencode.json(c)` by hand.

## Why

The OpenCode ecosystem page lists dozens of plugins, but trying one means
editing global configuration, remembering which packages you added, and
cleaning up manually when an experiment does not work out. Ecosystem Manager
keeps that bookkeeping in one place:

- **Catalog in the loop.** 39 plugins with a short description, V1/V2
  compatibility, and npm status.
- **Per-plugin switches.** Turning a switch on installs that package; turning
  it off uninstalls it.
- **Ownership tracking.** It only removes packages it installed. Plugins you
  added yourself are never touched.
- **Guarded installs.** A package must resolve on npm and be loadable by
  OpenCode V2 before the switch flips.
- **Local dashboard.** Search, filter, and toggle from a browser UI bound to
  `127.0.0.1`.
- **No JSONC damage.** Installs and removals go through
  `opencode plugin add/remove`, so comments and unrelated settings survive.

## Requirements

- OpenCode 2.x
- The `opencode` CLI on `PATH`, or an `OPENCODE_CLI` environment variable that
  points to the binary. The desktop app's bundled CLI is detected automatically.

## Install

```sh
opencode plugin add opencode-ecosystem-manager
```

Or add it to `~/.config/opencode/opencode.json(c)` manually:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-ecosystem-manager"]
}
```

Reload OpenCode after installing.

## Usage

Ask the agent to call the `ecosystem_manager` tool, or use the slash command:

```text
/ecosystem ui                   # open the browser dashboard
/ecosystem list                 # catalog, without refreshing npm
/ecosystem check                # refresh npm status, then list
/ecosystem status               # master switch and selected plugins
/ecosystem on opencode-tavily   # enable and install
/ecosystem off opencode-tavily  # disable and uninstall
/ecosystem enable               # enable master switch, install selections
/ecosystem disable              # disable master switch, uninstall managed
/ecosystem sync                 # reconcile config with saved state
```

`on` and `off` accept multiple names at once. Names may be catalog names or npm
package names. Packages outside the catalog are also accepted and installed
as-is.

### Dashboard

`/ecosystem ui` starts a dashboard on `127.0.0.1` (port `47821` when free,
otherwise an ephemeral port) and opens it in the default browser. It provides:

- Search and filtering across all catalog entries
- Descriptions, V1/V2 compatibility, and live npm status
- Per-plugin switches plus a master switch
- npm refresh and manual sync
- A one-time access token exchanged for an `HttpOnly`, `SameSite=Strict`
  cookie; API requests also validate `Origin`

The server lives with the OpenCode process, so the plugin reload triggered by
an install or uninstall does not tear down the dashboard. Run `/ecosystem ui`
again after restarting OpenCode.

## Safety rules

- Only the global config at `~/.config/opencode/opencode.json` is changed, and
  only through `opencode plugin add/remove`.
- Only packages recorded as managed in `state.json` are uninstalled.
- A switch is refused when npm returns 404, the package is deprecated, or the
  registry cannot be reached.
- Entries marked `v1` or `none` are refused because OpenCode V2 cannot load
  them. V2 and unknown ad-hoc packages are allowed.
- Turning the master switch off keeps the selection and uninstalls every
  managed package. Turning it back on reinstalls them.
- State is synchronized about two seconds after load and again after a
  configuration-triggered reload.

## Files and state

- `src/index.ts` — tool and `/ecosystem` command registration, auto-sync
- `src/manager.ts` — reconciliation, CLI calls, textual output
- `src/ui.ts` — local HTTP server, tokens, API
- `src/ui.html` — dashboard
- `src/catalog.ts` — 39-entry ecosystem catalog
- `src/npm.ts` — npm registry checks with a 30-minute cache
- `src/paths.ts` — config discovery, JSONC parsing, state I/O

State file: `~/.local/share/opencode/ecosystem-manager/state.json`

The catalog is a snapshot of the ecosystem page. When the upstream list changes,
update `src/catalog.ts`.

## Development

```sh
npm install
npm run typecheck
npm run pack:dry
```

To load the checkout without publishing, point OpenCode at the directory:

```jsonc
{
  "plugins": ["/absolute/path/to/OpencodeDesktopPluginManager"]
}
```

## License

MIT

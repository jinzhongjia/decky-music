---
name: decky-dev
description: Autonomous develop-deploy-debug loop for Steam Deck Decky Loader plugins — sideload deploys, log pulling, CEF/CDP automation of the running Steam UI (navigate, click, screenshot, key input), sleep inhibition, and on-device verification. Use when developing, deploying, or debugging any Decky plugin against a real Steam Deck.
---

# Decky Plugin Development & Debugging (generic)

Everything here is generic Decky knowledge. Repo-specific policy (deploy consent,
log content rules, commit rules) lives in the project's AGENTS.md and always wins.

## Target environment

- SteamOS in a **gamescope session**, user `deck`, reachable over SSH (`DECK_HOST`, e.g. `deck@192.168.0.18`).
- Decky Loader = `plugin_loader` systemd unit (root). Restart to reload plugins:
  `sudo systemctl restart plugin_loader`.
- Homebrew tree: `~/homebrew/{plugins,logs,settings,data}/<plugin name>` — directory names use
  `plugin.json`'s `name` field, spaces included.

## Plugin anatomy

- `main.py` `Plugin` class: `async` methods are the RPC surface for the frontend (`@decky/api`
  `callable`); `decky.emit` pushes events to the UI. Backend runs in Decky's **frozen CPython —
  stdlib only**, compiled extensions will break on Decky upgrades.
- `py_modules/` is the only extra dir added to `sys.path` and packaged by the CLI.
- Frontend ships as `dist/index.js` (built from `@decky/api` + `@decky/ui`).
- `package.json` `remote_binary`: assets downloaded at install time into `bin/<name>` —
  **saved verbatim, never unpacked**. Archives (e.g. Nuitka standalone tar.gz) must be
  self-extracted by plugin code on first use. Pin URLs to a release tag: `releases/latest/...`
  404s for prereleases.
- Installed permissions: plugin root dir is `root:root` (read-only for deck), but `bin/` and
  `py_modules/` are `deck:deck` (writable) — the remote_binary downloader itself writes `bin/`.

## Deploy loop (sideload)

Sideload = build → rsync the plugin subset → restart `plugin_loader`. Keep it in a repo script
(this repo: `scripts/deploy.sh`; override target with `DECK_HOST=deck@ip`). Two rules that bite:

- Deploy scripts **copy prebuilt artifacts, they don't build**. Rebuild changed binaries first,
  or you ship stale ones.
- A sideload `dev_mode` marker file (touched by the deploy script, absent from release zips) is a
  clean way to switch log verbosity; release zips must not contain it.

## Logs

- Backend logging goes through `decky.logger` → `DECKY_PLUGIN_LOG_DIR` →
  `~/homebrew/logs/<plugin name>/`, **one file per plugin_loader restart**; newest = current session.
- Pull the live log:

```bash
ssh "$DECK_HOST" 'f=$(ls -t "$HOME/homebrew/logs/<plugin name>/"*.log | head -1); tail -n 200 "$f"'
```

## Keep the Deck awake while debugging

The Deck auto-suspends on idle and kills SSH/CDP mid-verification. Hang a blocker before long
debug sessions, release it when done (don't leave the screen on overnight):

```bash
# nohup & dies with the ssh session — use a user systemd unit instead
ssh "$DECK_HOST" 'systemd-run --user --unit decky-dev-nosleep --collect \
  systemd-inhibit --what=idle:sleep --who=decky-dev --why="debugging" sleep infinity'
ssh "$DECK_HOST" 'systemd-inhibit --list --mode=block | grep decky'   # verify
ssh "$DECK_HOST" 'systemctl --user stop decky-dev-nosleep'            # release
```

## CDP: driving the running Steam UI

Steam's CEF exposes remote debugging on **port 8080** (enabled in Decky environments). The tunnel
outlives `plugin_loader` restarts — it belongs to Steam, open it once:

```bash
ssh -N -L 8080:localhost:8080 "$DECK_HOST" &
curl -s localhost:8080/json | jq '.[].title'
```

Key targets: `SharedJSContext` (main JS context, no pixels), `QuickAccess`, `MainMenu`, and the
**gamepad UI window** (title like "Steam Big Picture Mode" — the visible screen; screenshot this
one). Connect a target's `webSocketDebuggerUrl` with Node ≥ 21 (global `WebSocket`), then
`Runtime.enable` + `Runtime.evaluate`. Reference clients live in this repo's `scripts/cdp/`
(`cdp.mjs` evaluate, `cdp-shot.mjs` screenshot, `cdp-nav.mjs` route navigation, `cdp-key.mjs`
key input, README with probe recipes).

What works, learned the hard way:

- **DOM clicks drive gamepad UI**: `el.dispatchEvent(new MouseEvent("click", {bubbles: true}))`
  triggers both `onClick` and Focusable `onActivate`. Match elements by text; UI labels may have
  count badges appended, so match with `startsWith`, not equality.
- **Navigation**: use the original Router in the gamepad UI window; `@decky/ui`'s focused-window
  `Navigation` lands in the wrong window under CDP. Re-navigating to the current route does
  **not** remount the page — reset state by clicking a tab/home first.
- **Webpack probing** (find Valve's obfuscated modules):
  `window[webpackChunk...].push([[Symbol()],{},r=>req=r])` to grab require, then grep factory
  sources in `req.m` or instantiate with `req(id)`. Read-only diagnosis — never ship this.
- **Screenshot-based assertions**: `Page.captureScreenshot` on the gamepad UI target, then read
  the PNG. Verify playback/progress by timing two screenshots and comparing positions against
  wall-clock; verify lists by scrolling through and asserting row count / dedup keys / layout.

## The autonomous verification loop

```
rebuild (if binaries changed) → deploy → pull log (clean startup?)
→ CDP: navigate to plugin route → drive the flow (clicks/keys)
→ screenshot + assert → pull log again (no errors?) → iterate
```

For long waits (a song finishing, a background job), poll the log for the expected marker over
SSH in a background task instead of sleeping blind.

## On-device gotchas

- **Audio**: child processes need `XDG_RUNTIME_DIR=/run/user/<uid>` to reach PipeWire in the
  gamescope session; a Rust audio binary should dynamically link only `libasound` (check `ldd`).
- Verifying "it plays" without ears: position advancing at exactly 1.0× across two timed
  screenshots is strong evidence the pipeline is alive.
- The release install path (zip + remote_binary download + sha256) differs from sideload —
  archives arrive unextracted, `dev_mode` is absent, and the plugin root is root-owned. Test it
  by installing the CI zip via Decky developer mode at least once per release.

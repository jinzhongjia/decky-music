---
name: steam-cdp
description: Drive and inspect the running Steam client UI over the Chrome DevTools Protocol (CEF remote debugging, port 8080) — list targets, evaluate JS probes, navigate routes, click elements, dispatch keys, capture screenshots, stream console errors. Use for hands-free UI automation and read-only diagnosis of Steam's gamepad UI on a Steam Deck (or any Steam with CEF debugging enabled).
---

# Steam CDP Automation

Steam's embedded Chromium (CEF) exposes remote debugging on **localhost:8080** on the device
(enabled by default in Decky environments; desktop Steam needs `-cef-enable-debugging`).
Everything here is **read-only diagnosis and test driving** — never ship CDP tricks inside a
plugin. The bundled scripts live in `scripts/` next to this file and are dependency-free
(Node ≥ 21 for global `fetch`/`WebSocket`).

## Setup (once per machine session)

```bash
ssh -N -L 8080:localhost:8080 deck@<ip> &     # tunnel; survives plugin_loader restarts
node scripts/cdp.mjs targets                  # list targets, sanity-check the tunnel
```

## Targets

| Alias | Target | Use for |
|---|---|---|
| `bp` | gamepad-UI main window ("Steam Big Picture Mode" / localized) | the visible screen: screenshots, DOM clicks, key input |
| `qam` | QuickAccess | Quick Access Menu overlay |
| `mainmenu` | MainMenu | left Steam main menu overlay |
| `shared` / `sjc` | SharedJSContext | main JS context (no pixels) — webpack/module probing |

## Script inventory

```bash
node scripts/cdp.mjs targets                      # list targets with aliases
node scripts/cdp.mjs <target> <probe.js>          # Runtime.evaluate a JS file, print its return value
node scripts/cdp-nav.mjs /your-route              # navigate the gamepad UI to a route
node scripts/cdp-shot.mjs bp /tmp/ui.png          # screenshot a target to PNG
node scripts/cdp-key.mjs bp ArrowDown Enter       # dispatch keyDown/keyUp pairs
node scripts/cdp-console.mjs shared 30            # stream console warnings/errors for N seconds
node scripts/cdp.mjs mainmenu scripts/probe-mainmenu.js    # example probe: menu patch anchors
```

`cdp-lib.mjs` is the shared helper (target resolution, sessions, evaluate, screenshot, keys) —
import it to build new drivers.

## Writing probes

A probe is an IIFE evaluated in the target page that **returns a string**. Grab the React root:

```js
(() => {
  let el, key;
  for (const e of document.querySelectorAll("*")) {
    const k = Object.keys(e).find((k) => k.startsWith("__reactFiber"));
    if (k) { el = e; key = k; break; }
  }
  if (!el) return "no fiber";
  let root = el[key];
  while (root.return) root = root.return;
  // walk root.child / root.sibling; match memoizedProps (e.g. navID anchors)
})()
```

Webpack module extraction (find Valve's obfuscated modules — read-only!):

```js
window[Object.keys(window).find(k => k.startsWith("webpackChunk"))]
  .push([[Symbol()], {}, r => (req = r)]);
// grep factory sources: Object.entries(req.m).filter(([id, f]) => String(f).includes("SomeConstant"))
// instantiate: req(id)
```

## Calling a plugin's backend from a probe

Use the loader's WS route in `shared` — side-effect free:

```js
// read and write bridge state without disturbing the running plugin
await DeckyBackend.call("loader/call_plugin_method", "<Plugin Name>", "get_playback");
await DeckyBackend.call("loader/call_plugin_method", "<Plugin Name>", "volume", 0.6);
```

**Never** reach for `window.__DECKY_SECRET_INTERNALS_..._deckyLoaderAPIInit.connect(2, "<Plugin
Name>")` just to call a method. Every `connect()` does
`pluginEventListeners.set(pluginName, new Map())` in decky-loader — it **overwrites the plugin's
event-listener map**, so the real plugin frontend silently stops receiving its `decky.emit`
events from that moment on. Symptoms look exactly like a product bug: progress text frozen,
play/pause icon never flips, state stuck at whatever the last render had. Diagnosing that phantom
costs more than the probe saved.

If you do need `connect()` (e.g. simulating a frontend reload), hand ownership back afterwards
with `await DeckyPluginLoader.importPlugin("<Plugin Name>")` — re-importing the bundle re-runs
`@decky/api`, which calls `connect()` again — and don't call `connect()` after that point.

`importPlugin` on its own is the cheap way to reproduce a **frontend-only reload** (what a Steam
restart / desktop-mode round trip does to plugin frontends) without restarting `plugin_loader`,
so module-level state and mount-time hydration re-run while the backend keeps running.

**Is the UI actually live?** Sample a changing text (progress `m:ss / m:ss`, clock) twice a few
seconds apart in the same probe. Frozen text = the tree isn't re-rendering; don't trust any
single-shot DOM read as proof that state arrived.

## Driving the UI (hard-won rules)

- **DOM clicks work for gamepad activation**: `el.dispatchEvent(new MouseEvent("click",
  {bubbles: true}))` fires both `onClick` and Focusable `onActivate`. No need for synthetic
  gamepad input in most flows.
- **Match by text prefix, not equality** — labels often carry count badges
  (`textContent.trim().startsWith("Liked")`).
- **Navigation**: `cdp-nav.mjs` uses the raw Router on purpose; `@decky/ui`'s `Navigation`
  targets the focused window, which doesn't exist under CDP and lands elsewhere. Re-navigating
  to the current route does **not** remount the page — click a tab/home element to reset state.
- **Screenshot assertions**: screenshot `bp`, then Read the PNG. For playback/progress checks,
  take two screenshots a measured interval apart and compare position deltas against wall-clock
  (rate ≈ 1.0×). For lists, scroll through and assert row count / dedup keys / layout.
- After `cdp-nav.mjs` the page needs ~1s to settle before a screenshot is meaningful (the
  script already sleeps 900 ms).

## Pitfalls

- Shell quoting eats probe code — write probes to a file and pass the path; don't inline JS
  in `-e`-style arguments.
- `pkill -f "8080:localhost"` style cleanup can match your own shell's command line and kill
  it (zsh exit 144) — kill by PID instead.
- The visible screen is `bp`, not `SharedJSContext` — screenshots of `shared` are blank.
- After a Steam restart (desktop-mode round trip) the `bp` target gets a **new id** — re-resolve
  targets instead of reusing an id, or you read a dead window.
- Overlay targets (`qam`, `mainmenu`) only render while the overlay is open on-device.

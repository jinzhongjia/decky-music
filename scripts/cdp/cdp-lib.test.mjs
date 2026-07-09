import assert from "node:assert/strict";

import { cdpBaseUrl, keyEventParams, resolveTarget } from "./cdp-lib.mjs";

const ws = (id) => `ws://deck/devtools/page/${id}`;

const targets = [
  { id: "target-bp", title: "Steam Big Picture Mode", webSocketDebuggerUrl: ws("bp") },
  { id: "target-qam", title: "QuickAccess", webSocketDebuggerUrl: ws("qam") },
  { id: "target-shared", title: "SharedJSContext", webSocketDebuggerUrl: ws("shared") },
  { id: "target-main", title: "MainMenu", webSocketDebuggerUrl: ws("main") },
  { id: "music-route-1", title: "Decky Music UI", webSocketDebuggerUrl: ws("music") },
  { id: "prefix-match-abcdef", title: "Prefix fallback", webSocketDebuggerUrl: ws("prefix") },
];

assert.equal(resolveTarget(targets, "bp").id, "target-bp", "bp resolves to the Big Picture target");
assert.equal(
  resolveTarget(targets, "qam").id,
  "target-qam",
  "qam resolves to the QuickAccess target"
);
assert.equal(
  resolveTarget(targets, "shared").id,
  "target-shared",
  "shared resolves to SharedJSContext"
);
assert.equal(resolveTarget(targets, "mainmenu").id, "target-main", "mainmenu resolves to MainMenu");

assert.equal(
  resolveTarget(targets, "Music").id,
  "music-route-1",
  "unknown specs fall back to title substring matching"
);
assert.equal(
  resolveTarget(targets, "prefix-match").id,
  "prefix-match-abcdef",
  "unknown specs fall back to id prefix matching"
);

assert.equal(
  resolveTarget(
    [
      { id: "broken-qam", title: "QuickAccess" },
      { id: "working-qam", title: "QuickAccess", webSocketDebuggerUrl: ws("working-qam") },
    ],
    "qam"
  ).id,
  "working-qam",
  "targets without webSocketDebuggerUrl are ignored"
);

assert.throws(
  () => resolveTarget(targets, "missing"),
  (error) => {
    assert.match(error.message, /missing/);
    assert.match(error.message, /Steam Big Picture Mode/);
    assert.match(error.message, /QuickAccess/);
    assert.match(error.message, /SharedJSContext/);
    assert.match(error.message, /MainMenu/);
    return true;
  },
  "missing target errors list the requested spec and available target titles"
);

assert.equal(
  cdpBaseUrl({ DECK_CDP_URL: "http://deck:9222", DECK_CDP_HOST: "ignored", DECK_CDP_PORT: "9333" }),
  "http://deck:9222",
  "DECK_CDP_URL wins over host and port"
);
assert.equal(
  cdpBaseUrl({ DECK_CDP_HOST: "deck.local", DECK_CDP_PORT: "9333" }),
  "http://deck.local:9333",
  "DECK_CDP_HOST and DECK_CDP_PORT build the base URL when DECK_CDP_URL is absent"
);

assert.deepEqual(
  {
    key: keyEventParams("ArrowDown").key,
    code: keyEventParams("ArrowDown").code,
    windowsVirtualKeyCode: keyEventParams("ArrowDown").windowsVirtualKeyCode,
  },
  { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  "ArrowDown maps to the CDP key/code/virtual-key tuple"
);
assert.deepEqual(
  {
    key: keyEventParams("Enter").key,
    code: keyEventParams("Enter").code,
    windowsVirtualKeyCode: keyEventParams("Enter").windowsVirtualKeyCode,
  },
  { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
  "Enter maps to the CDP key/code/virtual-key tuple"
);
assert.deepEqual(
  {
    key: keyEventParams("Space").key,
    code: keyEventParams("Space").code,
    windowsVirtualKeyCode: keyEventParams("Space").windowsVirtualKeyCode,
  },
  { key: " ", code: "Space", windowsVirtualKeyCode: 32 },
  "Space maps to the CDP key/code/virtual-key tuple"
);
assert.deepEqual(
  {
    key: keyEventParams("a").key,
    code: keyEventParams("a").code,
    text: keyEventParams("a").text,
    windowsVirtualKeyCode: keyEventParams("a").windowsVirtualKeyCode,
  },
  { key: "a", code: "KeyA", text: "a", windowsVirtualKeyCode: 65 },
  "single letters map to printable CDP key events"
);

console.log("cdp-lib tests passed");

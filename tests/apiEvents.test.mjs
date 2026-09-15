import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileUi, uiHarness } from "./uiHarness.mjs";

const output = mkdtempSync(join(tmpdir(), "decky-events-"));
before(() => compileUi(output));
after(() => rmSync(output, { recursive: true, force: true }));
const track = { id: "1", name: "Song", singer: "Singer", cover: "", duration: 90 };
const variants = {
  player: [
    ["playing", { pos: 1, wall_ms: 12 }],
    ["paused", { pos: 2 }],
    ["unloaded", { pos: 3 }],
    ["ended", {}],
    ["error", { code: "fetch_failed", message: "Network failure" }],
    ["track", { index: 0, song: track }],
    ["track", { index: -1, song: null }],
    ["queue", { length: 1, index: 0, mode: "normal" }],
    ["queue", { length: 0, index: -1, mode: "radio" }],
  ],
  login: [
    ["qr", { qr: "synthetic-qr" }],
    ["qr", { qr: "synthetic-qr", mimetype: "image/png" }],
    ...["waiting", "scanned", "done", "timeout", "refuse"].map((type) => [type, {}]),
    ["error", { code: "login_failed", message: "Login failed" }],
  ],
  provider: [["error", { code: "provider_error", message: "Provider failure" }]],
};

for (const [domain, cases] of Object.entries(variants)) {
  test(`${domain}: all variants pass, unsubscribe stops delivery`, () => {
    const harness = uiHarness(output);
    const received = [];
    const subscribe = { player: "onPlayer", login: "onLogin", provider: "onProvider" }[domain];
    const stop = harness.api[subscribe]((event) => received.push(event));
    const events = cases.map(([type, data]) => ({ ev: domain, type, data }));
    events.forEach((event) => harness.emit(domain, event));
    assert.deepEqual(received, events);
    stop();
    events.forEach((event) => harness.emit(domain, event));
    assert.equal(received.length, events.length);
  });

  test(`${domain}: malformed envelopes and fields never invoke subscribers`, () => {
    const harness = uiHarness(output);
    let called = 0;
    const subscribe = { player: "onPlayer", login: "onLogin", provider: "onProvider" }[domain];
    harness.api[subscribe](() => called++);
    const bad = [null, [], true, "event", {}, { ev: domain, type: "unknown", data: {} }];
    for (const [type, data] of cases) {
      const event = { ev: domain, type, data };
      bad.push({ ...event, ev: "other" }, { ...event, data: [] }, { ...event, data: null });
      for (const [key, value] of Object.entries(data)) {
        if (key !== "mimetype") {
          const missing = { ...data };
          delete missing[key];
          bad.push({ ...event, data: missing });
        }
        bad.push({ ...event, data: { ...data, [key]: [] } });
        if (typeof value === "number") {
          for (const number of [NaN, Infinity, -Infinity])
            bad.push({ ...event, data: { ...data, [key]: number } });
        }
      }
    }
    bad.forEach((event) => harness.emit(domain, event));
    assert.equal(called, 0);
  });
}

test("invalid track fields and queue modes cannot mutate playback state", () => {
  const harness = uiHarness(output, { get_playback: () => new Promise(() => {}) });
  harness.store.startPlayer();
  harness.emit("player", { ev: "player", type: "track", data: { index: 0, song: track } });
  const before = JSON.stringify(harness.store.usePlayer());
  for (const key of Object.keys(track)) {
    const song = { ...track };
    delete song[key];
    harness.emit("player", { ev: "player", type: "track", data: { index: 0, song } });
    harness.emit("player", {
      ev: "player",
      type: "track",
      data: { index: 0, song: { ...track, [key]: false } },
    });
  }
  for (const song of [[], {}, false, { ...track, duration: Infinity }]) {
    harness.emit("player", { ev: "player", type: "track", data: { index: 0, song } });
  }
  harness.emit("player", {
    ev: "player",
    type: "queue",
    data: { length: 1, index: 0, mode: "shuffle" },
  });
  harness.emit("player", { ev: "player", type: "playing", data: { pos: NaN, wall_ms: 1 } });
  harness.emit("player", { ev: "player", type: "error", data: {} });
  assert.equal(JSON.stringify(harness.store.usePlayer()), before);
  assert.equal(harness.errors.useError()[0], null);
  assert.equal(harness.toasts.length, 0);
  harness.store.stopPlayer();
});

test("unknown diagnostic text is never displayed while stable errors stay localized", () => {
  const { api } = uiHarness(output);
  assert.notEqual(api.errorText("invalid_request"), api.errorText("unknown-code"));
  assert.equal(
    api.errorText("https://example.invalid/?token=synthetic-secret"),
    api.errorText("unknown-code")
  );
  assert.equal(api.errorText("constructor"), api.errorText("unknown-code"));
});

test("QAM action failures stay in the QAM error scope", async () => {
  const harness = uiHarness(output);
  await harness.errors.guard(async () => {
    throw new Error("invalid_request");
  }, "qam");
  assert.equal(harness.errors.useError("qam")[0], harness.api.errorText("invalid_request"));
  assert.equal(harness.errors.useError("page")[0], null);
});

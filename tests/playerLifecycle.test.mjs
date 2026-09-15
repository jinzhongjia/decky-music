import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileUi, deferred, uiHarness } from "./uiHarness.mjs";

const output = mkdtempSync(join(tmpdir(), "decky-player-store-"));
before(() => compileUi(output));
after(() => rmSync(output, { recursive: true, force: true }));
const track = { id: "current", name: "Current", singer: "Singer", cover: "", duration: 100 };
const snapshot = {
  current: track,
  index: 0,
  playing: true,
  pos: 10,
  wall: 1000,
  mode: "shuffle",
  queue_mode: "radio",
  radio_kind: "ncm_fm",
  volume: 0.3,
};
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const event = (type, data) => ({ ev: "player", type, data });

test("import is inert; repeated start/stop/restart neither leaks nor duplicates notifications", async () => {
  let hydrations = 0;
  const h = uiHarness(output, {
    get_playback: async () => {
      hydrations++;
      return snapshot;
    },
  });
  const failure = event("error", { code: "fetch_failed", message: "Network failure" });
  h.emit("player", failure);
  assert.equal(hydrations, 0);
  assert.equal(h.toasts.length, 0);
  h.store.startPlayer();
  h.store.startPlayer();
  await settle();
  assert.equal(hydrations, 1);
  assert.equal(h.store.usePlayer().current.id, "current");
  h.emit("player", failure);
  h.emit("player", failure);
  assert.equal(h.toasts.length, 1);
  h.store.stopPlayer();
  h.store.stopPlayer();
  h.errors.reportError(null);
  h.emit("player", event("track", { index: -1, song: null }));
  h.emit("player", failure);
  assert.equal(h.store.usePlayer().current.id, "current");
  assert.equal(h.errors.useError()[0], null);
  assert.equal(h.toasts.length, 1);
  h.store.startPlayer();
  await settle();
  h.emit("player", failure);
  assert.equal(hydrations, 2);
  assert.equal(h.toasts.length, 2);
  h.store.stopPlayer();
});

test("stop cancels queued volume RPC and ignores old hydration after restart", async () => {
  const old = deferred(),
    fresh = deferred();
  let hydrations = 0,
    volumes = 0;
  const h = uiHarness(output, {
    get_playback: () => (++hydrations === 1 ? old.promise : fresh.promise),
    volume: async () => {
      volumes++;
    },
  });
  h.store.startPlayer();
  h.store.setVolume(0.6);
  h.store.stopPlayer();
  h.flushTimers();
  assert.equal(volumes, 0);
  h.store.startPlayer();
  old.resolve({ ...snapshot, player_failed: true });
  await settle();
  assert.equal(h.store.usePlayer().current, null);
  assert.equal(h.errors.useError()[0], null);
  fresh.resolve({ ...snapshot, current: { ...track, id: "fresh" } });
  await settle();
  assert.equal(h.store.usePlayer().current.id, "fresh");
  h.store.stopPlayer();
});

test("stale failed actions cannot report across stop/restart; live stable failures still report", async () => {
  const stale = deferred(),
    live = deferred();
  let calls = 0;
  const h = uiHarness(output, {
    get_playback: async () => snapshot,
    next_track: () => (++calls === 1 ? stale.promise : live.promise),
  });
  h.store.startPlayer();
  await settle();
  const first = h.store.nextTrack();
  h.store.stopPlayer();
  h.store.startPlayer();
  await settle();
  stale.reject(new Error("https://example.invalid/?token=synthetic-secret"));
  await first;
  assert.equal(h.errors.useError()[0], null);
  assert.equal(h.toasts.length, 0);
  const second = h.store.nextTrack();
  live.reject(new Error("invalid_request"));
  await second;
  assert.equal(h.errors.useError()[0], h.api.errorText("invalid_request"));
  h.store.stopPlayer();
});

test("hydrate fills missing metadata without overwriting playback events or optimistic controls", async () => {
  const pending = deferred();
  const volumes = [];
  const h = uiHarness(output, {
    get_playback: () => pending.promise,
    volume: async (value) => {
      volumes.push(value);
    },
    seek: async () => {},
    set_play_mode: async () => {},
  });
  h.store.startPlayer();
  h.emit("player", event("playing", { pos: 22, wall_ms: 2200 }));
  h.emit("player", event("queue", { length: 5, index: 0, mode: "normal" }));
  h.store.setVolume(0.7);
  h.store.cycleMode();
  h.store.seek(24);
  pending.resolve(snapshot);
  await settle();
  const current = h.store.usePlayer();
  assert.equal(current.current.id, track.id);
  assert.equal(current.playing, true);
  assert.equal(current.posSec, 24);
  assert.equal(current.queueMode, "normal");
  assert.equal(current.mode, "single_loop");
  assert.equal(current.volume, 0.7);
  h.flushTimers();
  await settle();
  assert.deepEqual(volumes, [0.7]);
  h.store.stopPlayer();
});

test("track events and optimistic queue replacement beat an older hydration", async () => {
  for (const replace of [
    (h) => h.emit("player", event("track", { index: -1, song: null })),
    (h) =>
      h.store.playQueue(
        [{ mid: "new", name: "New", singer: "S", cover: "", duration: 50, album: "", vip: false }],
        0
      ),
  ]) {
    const pending = deferred();
    const h = uiHarness(output, {
      get_playback: () => pending.promise,
      play_queue: async () => {},
    });
    h.store.startPlayer();
    replace(h);
    const expected = h.store.usePlayer().current;
    pending.resolve(snapshot);
    await settle();
    assert.strictEqual(h.store.usePlayer().current, expected);
    if (expected === null) assert.equal(h.store.usePlayer().playing, false);
    h.store.stopPlayer();
  }
});

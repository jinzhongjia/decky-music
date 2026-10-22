import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileUi, uiHarness } from "./uiHarness.mjs";

const output = mkdtempSync(join(tmpdir(), "decky-player-seek-"));
before(() => compileUi(output));
after(() => rmSync(output, { recursive: true, force: true }));
const track = { id: "song", name: "Song", singer: "", cover: "", duration: 100 };
const event = (type, data) => ({ ev: "player", type, data });
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

// Paused at 10s by default so positions do not drift with the wall clock.
async function started({ playing = false } = {}) {
  const seeks = [];
  const calls = [];
  const h = uiHarness(output, {
    get_playback: async () => ({
      current: track,
      index: 0,
      playing,
      pos: 10,
      wall: Date.now(),
      mode: "list_loop",
      queue_mode: "normal",
      radio_kind: "",
      volume: 0.5,
    }),
    seek: async (sec) => {
      seeks.push(sec);
      calls.push(`seek ${Math.round(sec)}`);
    },
    pause: async () => {
      calls.push("pause");
    },
    resume: async () => {
      calls.push("resume");
    },
  });
  h.store.startPlayer();
  await settle();
  return { h, seeks, calls, view: () => h.store.usePlayer() };
}

test("a held direction previews locally and sends one seek after input pauses", async () => {
  const { h, seeks, view } = await started();
  for (let i = 0; i < 6; i++) h.store.scrubBy(5);
  assert.equal(view().scrubTarget, 40);
  // Reports that predate the gesture move neither the preview nor the base of the next step.
  h.emit("player", event("paused", { pos: 15 }));
  h.store.scrubBy(5);
  assert.equal(view().scrubTarget, 45);
  assert.deepEqual(seeks, []);
  h.flushTimers();
  await settle();
  assert.deepEqual(seeks, [45]);
  assert.equal(view().scrubTarget, null);
  assert.equal(view().posSec, 45);
  h.store.stopPlayer();
});

test("reports queued before the seek do not drag the bar back; a matching one resumes following", async () => {
  const { h, view } = await started();
  h.store.scrubBy(30);
  h.store.commitScrub();
  h.emit("player", event("paused", { pos: 12 }));
  assert.equal(view().posSec, 40);
  h.emit("player", event("paused", { pos: 40.3 }));
  assert.equal(view().posSec, 40.3);
  h.emit("player", event("paused", { pos: 12 }));
  assert.equal(view().posSec, 12);
  h.store.stopPlayer();
});

test("a failed seek releases the hold so the real position comes back", async () => {
  const { h, view } = await started();
  h.store.scrubBy(30);
  h.store.commitScrub();
  h.emit("player", event("error", { code: "seek_failed", message: "seek failed" }));
  h.emit("player", event("paused", { pos: 10 }));
  assert.equal(view().posSec, 10);
  h.store.stopPlayer();
});

test("scrub targets clamp to the track and need a known duration", async () => {
  const { h, seeks, view } = await started();
  h.store.scrubBy(-50);
  assert.equal(view().scrubTarget, 0);
  h.store.scrubBy(500);
  assert.equal(view().scrubTarget, 100);
  h.store.commitScrub();
  await settle();
  h.emit("player", event("track", { index: 1, song: { ...track, id: "live", duration: 0 } }));
  h.store.scrubBy(5);
  assert.equal(view().scrubTarget, null);
  h.flushTimers();
  await settle();
  assert.deepEqual(seeks, [100]);
  h.store.stopPlayer();
});

test("switching tracks drops an uncommitted target instead of seeking the new song", async () => {
  const { h, seeks, view } = await started();
  h.store.scrubBy(5);
  h.emit("player", event("track", { index: 1, song: { ...track, id: "next" } }));
  assert.equal(view().scrubTarget, null);
  h.flushTimers();
  h.store.commitScrub();
  await settle();
  assert.deepEqual(seeks, []);
  h.emit("player", event("playing", { pos: 3, wall_ms: Date.now() }));
  assert.equal(view().posSec, 3);
  h.store.stopPlayer();
});

test("leaving the bar commits at once; stopping the store cancels a pending commit", async () => {
  const { h, seeks } = await started();
  h.store.scrubBy(5);
  h.store.commitScrub();
  h.store.commitScrub();
  await settle();
  assert.deepEqual(seeks, [15]);
  h.store.scrubBy(5);
  h.store.stopPlayer();
  h.flushTimers();
  await settle();
  assert.deepEqual(seeks, [15]);
});

test("a single tap seeks while playing on; a held direction pauses once and resumes at the target", async () => {
  const { h, calls } = await started({ playing: true });
  h.store.scrubBy(5);
  h.flushTimers();
  await settle();
  assert.deepEqual(calls, ["seek 15"]);
  h.emit("player", event("playing", { pos: 15, wall_ms: Date.now() }));
  calls.length = 0;
  h.store.scrubBy(5);
  h.store.scrubBy(5);
  h.emit("player", event("paused", { pos: 15.2 }));
  h.store.scrubBy(5);
  assert.deepEqual(calls, ["pause"]);
  assert.equal(Math.round(h.store.usePlayer().scrubTarget), 30);
  h.flushTimers();
  await settle();
  assert.deepEqual(calls, ["pause", "seek 30", "resume"]);
  h.store.stopPlayer();
});

test("scrubbing a paused track never resumes it", async () => {
  const { h, calls } = await started();
  h.store.scrubBy(5);
  h.store.scrubBy(5);
  h.store.commitScrub();
  await settle();
  assert.deepEqual(calls, ["seek 20"]);
  h.store.stopPlayer();
});

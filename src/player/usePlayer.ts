// Plugin-owned playback store. Bridge remains the source of truth across frontend reloads.
import { toaster } from "@decky/api";
import { useEffect, useState } from "react";

import {
  PlayMode,
  PlayerEvent,
  QueueItem,
  QueueMode,
  Song,
  TrackInfo,
  api,
  errorText,
  onPlayer,
} from "../api";
import { guard, reportError } from "../errors";
import { t } from "../i18n";

type State = {
  current: TrackInfo | null;
  playing: boolean;
  posSec: number;
  wallMs: number;
  // Uncommitted gamepad scrub target; the bar shows it instead of the live position.
  scrubTarget: number | null;
  mode: PlayMode;
  queueMode: QueueMode;
  volume: number;
};
const initialState: State = {
  current: null,
  playing: false,
  posSec: 0,
  wallMs: 0,
  scrubTarget: null,
  mode: "list_loop",
  queueMode: "normal",
  volume: 0.8,
};
const state = { ...initialState };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const TOAST_THROTTLE_MS = 30_000;
const VOLUME_DEBOUNCE_MS = 150;
// A held direction repeats faster than the player can seek a stream: preview locally and send
// one seek once input pauses. Afterwards, reports far from the target predate the seek.
const SEEK_COMMIT_MS = 500;
const SEEK_SETTLE_MS = 5000;
const SEEK_TOLERANCE_S = 2;
let volumeTimer: number | undefined;
let seekTimer: number | undefined;
// Scrubbing while committedAt is unset; then the sent seek until a report confirms it.
// paused: the scrub turned continuous and paused playback, so committing resumes it.
let scrub: { trackId: string; target: number; committedAt?: number; paused?: boolean } | null =
  null;
let unsubscribe: (() => void) | undefined;
let active = false;
let generation = 0;
let hydrating = false;
let lastToast = { code: "", at: 0 };
// Independent revisions protect events AND optimistic user input from an older snapshot.
const revisions = { track: 0, playback: 0, queue: 0, mode: 0, volume: 0 };

function toastError(code: string, body: string) {
  const now = Date.now();
  if (code === lastToast.code && now - lastToast.at < TOAST_THROTTLE_MS) return;
  lastToast = { code, at: now };
  try {
    toaster.toast({ title: t("music"), body });
  } catch {
    // The plugin banner remains available if the host toaster has already dismounted.
  }
}

const livePos = () =>
  state.playing ? state.posSec + (Date.now() - state.wallMs) / 1000 : state.posSec;

// Reports queued before the seek ran (earlier seeks, periodic anchors) would drag the bar back.
function predatesSeek(pos: number) {
  if (!scrub) return false;
  if (scrub.committedAt === undefined) return true;
  const elapsed = Date.now() - scrub.committedAt;
  const expected = scrub.target + (state.playing ? elapsed / 1000 : 0);
  if (elapsed < SEEK_SETTLE_MS && Math.abs(pos - expected) > SEEK_TOLERANCE_S) return true;
  scrub = null; // the seek landed (or never will): follow the player again
  return false;
}

// The target belongs to a track that is gone: never commit it, never hold reports for it.
function dropScrub() {
  clearTimeout(seekTimer);
  seekTimer = undefined;
  scrub = null;
  state.scrubTarget = null;
}

function receivePlayer(e: PlayerEvent) {
  if (e.type === "playing" || e.type === "paused" || e.type === "unloaded") {
    revisions.playback++;
    state.playing = e.type === "playing";
    if (!predatesSeek(e.data.pos)) {
      state.posSec = e.data.pos;
      if (e.type === "playing") state.wallMs = e.data.wall_ms;
    }
  } else if (e.type === "ended" || e.type === "error") {
    revisions.playback++;
    state.playing = false;
    // A failed or finished seek: every later report is the real position again.
    if (scrub?.committedAt !== undefined) scrub = null;
    if (e.type === "error") {
      const message = errorText(e.data.code) || t("playError");
      reportError(message);
      toastError(e.data.code, message);
    }
  } else if (e.type === "track") {
    revisions.track++;
    if (e.data.song?.id !== state.current?.id) dropScrub();
    state.current = e.data.song;
    if (!e.data.song) {
      revisions.playback++;
      state.playing = false;
    }
  } else if (e.type === "queue") {
    revisions.queue++;
    state.queueMode = e.data.mode;
  }
  // No polling: a position event can retry a missing track after a failed hydration.
  if (!state.current && (e.type === "playing" || e.type === "paused")) hydrate();
  notify();
}

async function hydrate() {
  if (!active || hydrating) return;
  hydrating = true;
  const epoch = generation;
  const before = { ...revisions };
  try {
    const snapshot = await api.getPlayback();
    if (!active || generation !== epoch) return;
    if (snapshot.player_failed) reportError(errorText("player_start_failed"));
    if (revisions.track === before.track) state.current = snapshot.current;
    if (revisions.playback === before.playback) {
      state.playing = snapshot.playing;
      state.posSec = snapshot.pos;
      state.wallMs = snapshot.wall;
    }
    if (revisions.mode === before.mode) state.mode = snapshot.mode;
    if (revisions.queue === before.queue) state.queueMode = snapshot.queue_mode;
    if (revisions.volume === before.volume && Number.isFinite(snapshot.volume)) {
      state.volume = snapshot.volume!;
    }
    notify();
  } catch {
    // Later position events may retry; failed/stopped hydration must never escape to Steam.
  } finally {
    if (active && generation === epoch) hydrating = false;
  }
}

export function startPlayer() {
  if (active) return;
  active = true;
  const epoch = ++generation;
  Object.assign(state, initialState);
  scrub = null;
  lastToast = { code: "", at: 0 };
  unsubscribe = onPlayer((event) => {
    if (active && generation === epoch) receivePlayer(event);
  });
  notify();
  void hydrate();
}

export function stopPlayer() {
  if (!active) return;
  active = false;
  generation++;
  clearTimeout(volumeTimer);
  volumeTimer = undefined;
  dropScrub();
  hydrating = false;
  unsubscribe?.();
  unsubscribe = undefined;
}

function action(fn: () => Promise<unknown>) {
  if (!active) return Promise.resolve();
  const epoch = generation;
  return guard(fn, "page", () => active && generation === epoch);
}

// Bridge persists this rich metadata; queue actions also reuse this conversion.
export const toQueueItem = ({
  mid,
  media_mid,
  max_quality,
  name,
  singer,
  cover,
  duration,
}: Song): QueueItem => ({
  id: mid,
  media_mid,
  max_quality,
  name,
  singer,
  cover,
  duration,
});

export function playQueue(songs: Song[], startIndex: number) {
  if (!active) return;
  const song = songs[startIndex];
  if (!song) return;
  revisions.track++;
  state.current = {
    id: song.mid,
    name: song.name,
    singer: song.singer,
    cover: song.cover,
    duration: song.duration,
  };
  notify();
  void action(() => api.playQueue(songs.map(toQueueItem), startIndex));
}

export const nextTrack = () => action(() => api.nextTrack());
export const prevTrack = () => action(() => api.prevTrack());
export const togglePlay = () => action(() => (state.playing ? api.pause() : api.resume()));

/** Explicit jump: optimistic position, one seek, then hold reports that predate it. */
export function seek(sec: number, resume = false) {
  if (!active) return;
  clearTimeout(seekTimer);
  seekTimer = undefined;
  scrub = { trackId: state.current?.id ?? "", target: sec, committedAt: Date.now() };
  state.scrubTarget = null;
  revisions.playback++;
  state.posSec = sec;
  state.wallMs = Date.now();
  notify();
  void action(async () => {
    await api.seek(sec);
    if (resume) await api.resume();
  });
}

/** Gamepad scrub step: moves a local target (accumulated, never re-based on a lagging report)
 * and commits a single seek once input pauses for SEEK_COMMIT_MS. A single tap keeps playing;
 * a second step before the commit means the direction is held, so playback pauses until the
 * commit seeks and resumes at the target. */
export function scrubBy(deltaSec: number) {
  const track = state.current;
  if (!active || !track || !(track.duration > 0)) return;
  const s = scrub;
  const held = s !== null && s.committedAt === undefined && s.trackId === track.id;
  const from = held ? s.target : livePos();
  const target = Math.max(0, Math.min(track.duration, from + deltaSec));
  const paused = held && (s.paused || (state.playing && pauseForScrub()));
  scrub = { trackId: track.id, target, paused };
  state.scrubTarget = target;
  notify();
  clearTimeout(seekTimer);
  const epoch = generation;
  seekTimer = setTimeout(() => {
    seekTimer = undefined;
    if (active && generation === epoch) commitScrub();
  }, SEEK_COMMIT_MS);
}

function pauseForScrub() {
  void action(() => api.pause());
  return true;
}

/** Commit a pending scrub now (input paused, focus left the bar, page left). */
export function commitScrub() {
  const s = scrub;
  if (!active || !s || s.committedAt !== undefined) return;
  if (state.current?.id === s.trackId) return seek(s.target, s.paused);
  dropScrub();
  notify();
}

export function setVolume(val: number) {
  if (!active) return;
  revisions.volume++;
  state.volume = Math.max(0, Math.min(1, val));
  notify();
  clearTimeout(volumeTimer);
  const epoch = generation;
  volumeTimer = setTimeout(() => {
    volumeTimer = undefined;
    if (active && generation === epoch) void action(() => api.volume(state.volume));
  }, VOLUME_DEBOUNCE_MS);
}

const MODES: PlayMode[] = ["list_loop", "single_loop", "shuffle"];
export function cycleMode() {
  if (!active) return;
  revisions.mode++;
  state.mode = MODES[(MODES.indexOf(state.mode) + 1) % MODES.length];
  notify();
  void action(() => api.setPlayMode(state.mode));
}

export function usePlayer() {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force((x) => x + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return { ...state };
}

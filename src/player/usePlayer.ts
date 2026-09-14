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
  mode: PlayMode;
  queueMode: QueueMode;
  volume: number;
};
const initialState: State = {
  current: null,
  playing: false,
  posSec: 0,
  wallMs: 0,
  mode: "list_loop",
  queueMode: "normal",
  volume: 0.8,
};
const state = { ...initialState };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const TOAST_THROTTLE_MS = 30_000;
const VOLUME_DEBOUNCE_MS = 150;
let volumeTimer: number | undefined;
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

function receivePlayer(e: PlayerEvent) {
  if (e.type === "playing" || e.type === "paused" || e.type === "unloaded") {
    revisions.playback++;
    state.playing = e.type === "playing";
    state.posSec = e.data.pos;
    if (e.type === "playing") state.wallMs = e.data.wall_ms;
  } else if (e.type === "ended" || e.type === "error") {
    revisions.playback++;
    state.playing = false;
    if (e.type === "error") {
      const message = errorText(e.data.code) || t("playError");
      reportError(message);
      toastError(e.data.code, message);
    }
  } else if (e.type === "track") {
    revisions.track++;
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
  name,
  singer,
  cover,
  duration,
}: Song): QueueItem => ({
  id: mid,
  media_mid,
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

export function seek(sec: number) {
  if (!active) return;
  revisions.playback++;
  state.posSec = sec;
  state.wallMs = Date.now();
  notify();
  void action(() => api.seek(sec));
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

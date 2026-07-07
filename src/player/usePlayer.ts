// 共享播放状态(provider 无关):模块级 store,单一订阅 player 事件,跨组件/重挂共享。
// MiniPlayer / NowPlaying / 各屏都读它;播放动作也走这里(而非散落调 api.*)。

import { useEffect, useState } from "react";

import { PlayMode, PlayerEv, Song, api, errorText, onPlayer } from "../api";
import { guard, reportError } from "../errors";
import { t } from "../i18n";

type State = {
  queue: Song[]; // 前端持有的当前队列(用于展示;bridge 是真相源)
  index: number; // 当前曲索引;-1 = 空
  playing: boolean;
  posSec: number; // 最近一次上报的播放位置
  wallMs: number; // 该位置对应的墙钟(用于本地插值:pos + (now - wallMs))
  mode: PlayMode;
};

const state: State = {
  queue: [],
  index: -1,
  playing: false,
  posSec: 0,
  wallMs: 0,
  mode: "list_loop",
};
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

// 单一订阅:所有 player 事件在此汇入 store(模块加载时装一次,整个插件生命周期有效)
onPlayer((e) => {
  if (e.type === PlayerEv.Playing) {
    state.playing = true;
    state.posSec = e.data.pos;
    state.wallMs = e.data.wall_ms;
  } else if (e.type === PlayerEv.Paused) {
    state.playing = false;
    state.posSec = e.data.pos;
  } else if (e.type === PlayerEv.Ended) {
    state.playing = false;
  } else if (e.type === PlayerEv.Track) {
    state.index = e.data.index;
  } else if (e.type === PlayerEv.Error) {
    state.playing = false;
    reportError(errorText(e.data.code) || t("playError"));
  }
  notify();
});

// ---- 动作 ----

export function playQueue(songs: Song[], startIndex: number) {
  state.queue = songs;
  state.index = startIndex;
  notify();
  guard(() =>
    api.playQueue(
      songs.map((s) => ({ id: s.mid, media_mid: s.media_mid })),
      startIndex
    )
  );
}

export const nextTrack = () => guard(() => api.nextTrack());
export const prevTrack = () => guard(() => api.prevTrack());
export const togglePlay = () => guard(() => (state.playing ? api.pause() : api.resume()));

export function seek(sec: number) {
  state.posSec = sec;
  state.wallMs = Date.now();
  notify();
  guard(() => api.seek(sec));
}

const MODES: PlayMode[] = ["list_loop", "single_loop", "shuffle"];
export function cycleMode() {
  state.mode = MODES[(MODES.indexOf(state.mode) + 1) % MODES.length];
  notify();
  guard(() => api.setPlayMode(state.mode));
}

// ---- hook ----

export function usePlayer() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  const current = state.index >= 0 ? state.queue[state.index] : undefined;
  return {
    current,
    index: state.index,
    queue: state.queue,
    playing: state.playing,
    mode: state.mode,
    posSec: state.posSec,
    wallMs: state.wallMs,
  };
}

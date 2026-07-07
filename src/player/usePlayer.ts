// 共享播放状态(provider 无关):模块级 store,单一订阅 player 事件,跨组件/重挂共享。
// bridge 是真相源:current 来自 bridge(track 事件 / 挂载回灌 get_playback),不依赖前端队列,
// 因此前端重载后仍能同步(修 "退出重进播放条空" 的 desync)。

import { useEffect, useState } from "react";

import { PlayMode, PlayerEv, Song, TrackInfo, api, errorText, onPlayer } from "../api";
import { guard, reportError } from "../errors";
import { t } from "../i18n";

type State = {
  current: TrackInfo | null; // 当前曲(bridge 下发)
  playing: boolean;
  posSec: number; // 最近上报位置
  wallMs: number; // 该位置墙钟(插值:pos + (now - wallMs))
  mode: PlayMode;
};

const state: State = { current: null, playing: false, posSec: 0, wallMs: 0, mode: "list_loop" };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

let gotEvent = false; // 收到任何 player 事件后,不再用(可能更旧的)回灌快照覆盖

// 单一订阅:所有 player 事件汇入 store(模块加载时装一次,整个插件生命周期有效)
onPlayer((e) => {
  gotEvent = true;
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
    state.current = e.data.song;
  } else if (e.type === PlayerEv.Error) {
    state.playing = false;
    reportError(errorText(e.data.code) || t("playError"));
  }
  notify();
});

// 挂载回灌:向 bridge 拉当前播放态(前端重载后 store 为空时补齐);若期间已来事件则不覆盖
api
  .getPlayback()
  .then((s) => {
    if (gotEvent || !s.current) return;
    state.current = s.current;
    state.playing = s.playing;
    state.posSec = s.pos;
    state.wallMs = s.wall;
    state.mode = s.mode;
    notify();
  })
  .catch(() => {});

// ---- 动作 ----

export function playQueue(songs: Song[], startIndex: number) {
  state.current = toTrack(songs[startIndex]); // 乐观更新,UI 即时反映
  notify();
  guard(() =>
    api.playQueue(
      songs.map((s) => ({
        id: s.mid,
        media_mid: s.media_mid,
        name: s.name,
        singer: s.singer,
        cover: s.cover,
        duration: s.duration,
      })),
      startIndex
    )
  );
}

const toTrack = (s: Song): TrackInfo => ({
  id: s.mid,
  name: s.name,
  singer: s.singer,
  cover: s.cover,
  duration: s.duration,
});

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
  return {
    current: state.current,
    playing: state.playing,
    mode: state.mode,
    posSec: state.posSec,
    wallMs: state.wallMs,
  };
}

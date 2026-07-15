// 共享播放状态(provider 无关):模块级 store,单一订阅 player 事件,跨组件/重挂共享。
// bridge 是真相源:current 来自 bridge(track 事件 / 挂载回灌 get_playback),不依赖前端队列,
// 因此前端重载后仍能同步(修 "退出重进播放条空" 的 desync)。

import { useEffect, useState } from "react";

import {
  PlayMode,
  PlayerEv,
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
  current: TrackInfo | null; // 当前曲(bridge 下发)
  playing: boolean;
  posSec: number; // 最近上报位置
  wallMs: number; // 该位置墙钟(插值:pos + (now - wallMs))
  mode: PlayMode;
  queueMode: QueueMode; // radio 时 UI 隐藏上一首/队列等控件
  volume: number; // 0..1
};

const state: State = {
  current: null,
  playing: false,
  posSec: 0,
  wallMs: 0,
  mode: "list_loop",
  queueMode: "normal",
  volume: 0.8,
};
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
    if (!e.data.song) state.playing = false; // song=null:队列清空进入空态
  } else if (e.type === PlayerEv.Queue) {
    state.queueMode = e.data.mode; // 电台/普通模式跟随 bridge 广播
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
    if (typeof s.volume === "number") state.volume = s.volume; // 音量无事件,始终回灌
    if (gotEvent || !s.current) {
      notify();
      return;
    }
    state.current = s.current;
    state.playing = s.playing;
    state.posSec = s.pos;
    state.wallMs = s.wall;
    state.mode = s.mode;
    state.queueMode = s.queue_mode ?? "normal";
    notify();
  })
  .catch(() => {});

// ---- 动作 ----

// Song → 队列项(bridge 存富信息作真相源);X 菜单入队也用
export const toQueueItem = (s: Song): QueueItem => ({
  id: s.mid,
  media_mid: s.media_mid,
  name: s.name,
  singer: s.singer,
  cover: s.cover,
  duration: s.duration,
});

export function playQueue(songs: Song[], startIndex: number) {
  state.current = toTrack(songs[startIndex]); // 乐观更新,UI 即时反映
  notify();
  guard(() => api.playQueue(songs.map(toQueueItem), startIndex));
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

export function setVolume(val: number) {
  state.volume = Math.max(0, Math.min(1, val));
  notify();
  guard(() => api.volume(state.volume));
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
    queueMode: state.queueMode,
    volume: state.volume,
    posSec: state.posSec,
    wallMs: state.wallMs,
  };
}

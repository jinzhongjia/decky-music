// 共享播放状态(provider 无关):模块级 store,单一订阅 player 事件,跨组件/重挂共享。
// bridge 是真相源:current 来自 bridge(track 事件 / 挂载回灌 get_playback),不依赖前端队列,
// 因此前端重载后仍能同步(修 "退出重进播放条空" 的 desync)。

import { toaster } from "@decky/api";
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

// 系统通知节流:同一错误码 30s 内只弹一次。断网时每次自动切歌重试都会来一条 error 事件,
// 不节流会连着刷屏。按 code 而非按消息:换了别的错误码说明是新情况,立刻弹。
// 横幅不节流 —— 它是单个覆盖式槽位,本来就不会堆积。
const TOAST_THROTTLE_MS = 30_000;
const VOLUME_DEBOUNCE_MS = 150;
let volumeTimer: number | undefined;

function flushVolume() {
  volumeTimer = undefined;
  void guard(() => api.volume(state.volume), "volume");
}
let lastToast = { code: "", at: 0 };
function toastError(code: string, body: string) {
  const now = Date.now();
  if (code === lastToast.code && now - lastToast.at < TOAST_THROTTLE_MS) return;
  lastToast = { code, at: now };
  toaster.toast({ title: t("music"), body });
}

// 只有 track 事件带曲目身份 —— 它到了才不必再用回灌快照的 current。
// (曾用"收到任何事件"作判据:playing 位置锚点每 3s 一条,抢在回灌响应前到就把整份快照丢掉,
//  留下 playing=true / current=null —— 有声无曲,而停播入口全都 gate 在 current 上,音乐关不掉。
//  桌面模式往返最易触发:Steam 重启重载前端,而 bridge/player 还在放。)
let gotTrack = false;

// 单一订阅:所有 player 事件汇入 store(模块加载时装一次,整个插件生命周期有效)
onPlayer((e) => {
  if (e.type === PlayerEv.Playing) {
    state.playing = true;
    state.posSec = e.data.pos;
    state.wallMs = e.data.wall_ms;
  } else if (e.type === PlayerEv.Paused || e.type === PlayerEv.Unloaded) {
    state.playing = false;
    state.posSec = e.data.pos;
  } else if (e.type === PlayerEv.Ended) {
    state.playing = false;
  } else if (e.type === PlayerEv.Track) {
    gotTrack = true;
    state.current = e.data.song;
    if (!e.data.song) state.playing = false; // song=null:队列清空进入空态
  } else if (e.type === PlayerEv.Queue) {
    state.queueMode = e.data.mode; // 电台/普通模式跟随 bridge 广播
  } else if (e.type === PlayerEv.Error) {
    state.playing = false;
    const msg = errorText(e.data.code) || t("playError");
    reportError(msg); // 插件 UI 内的横幅:可关闭、留得住,便于在页面里排查
    // 播放错误多半发生在你没看着插件的时候(在玩游戏/在别的界面),横幅在那时等于没提示。
    // 再发一条 Steam 系统通知,保证"歌停了却不知道为什么"不会再出现。
    toastError(e.data.code, msg);
  }
  // 有声无曲兜底:播放态在动但 store 没当前曲(回灌失败/丢事件)→ 补拉一次,
  // 否则 UI 一直"没在播放"、连暂停入口都摸不到。下一条锚点最多 3s 后必再试。
  if (!state.current && (e.type === PlayerEv.Playing || e.type === PlayerEv.Paused)) hydrate();
  notify();
});

// 挂载回灌:向 bridge 拉当前播放态(前端重载后 store 为空时补齐)。
// 快照由 bridge 在响应时刻生成,不会比"响应前收到的事件"更旧(pos/playing 同源于同一批锚点),
// 唯一例外是 track 已把新曲送到 → 那时只跳过 current 那一段。
let hydrating = false;
function hydrate() {
  if (hydrating) return;
  hydrating = true;
  api
    .getPlayback()
    .then((s) => {
      hydrating = false;
      if (s.player_failed) reportError(errorText("player_start_failed")); // #38:启动失败回灌兜底(emit 易丢)
      if (typeof s.volume === "number") state.volume = s.volume; // 音量无事件,始终回灌
      if (gotTrack || !s.current) {
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
    .catch(() => {
      hydrating = false;
    });
}
hydrate();

// ---- 动作 ----

// Song → 展示信息 / 队列项(后者多一个 media_mid,QQ 取播放地址用)。
// bridge 存队列项的富信息作真相源;X 菜单入队也用 toQueueItem。
const toTrack = ({ mid, name, singer, cover, duration }: Song): TrackInfo => ({
  id: mid,
  name,
  singer,
  cover,
  duration,
});
export const toQueueItem = (s: Song): QueueItem => ({ ...toTrack(s), media_mid: s.media_mid });

export function playQueue(songs: Song[], startIndex: number) {
  state.current = toTrack(songs[startIndex]); // 乐观更新,UI 即时反映
  notify();
  guard(() => api.playQueue(songs.map(toQueueItem), startIndex));
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

export function setVolume(val: number) {
  state.volume = Math.max(0, Math.min(1, val));
  notify();
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(flushVolume, VOLUME_DEBOUNCE_MS);
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

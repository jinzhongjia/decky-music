/**
 * 播放器状态管理 Hook
 * 使用全局 Audio 单例，确保关闭面板后音乐继续播放
 * 支持播放列表和自动播放下一首
 * 支持播放历史记录
 * 支持播放时禁止系统休眠
 */

import { useState, useCallback, useEffect } from "react";
import { toaster } from "@decky/api";
import { getSongUrl, getSongLyric } from "../api";
import type { PlayMode, SongInfo } from "../types";
import { parseLyric, type ParsedLyric } from "../utils/lyricParser";

// ==================== 休眠控制 ====================
// 参考 DeckyInhibitScreenSaver 实现

interface SettingDef {
  field: number;
  wireType: number;
}

const SettingDefaults: Record<string, SettingDef> = {
  battery_idle: { field: 1, wireType: 5 },
  ac_idle: { field: 2, wireType: 5 },
  battery_suspend: { field: 3, wireType: 5 },
  ac_suspend: { field: 4, wireType: 5 },
};

// 保存原始休眠设置
interface OriginalSleepSettings {
  batteryIdle: number;
  acIdle: number;
  batterySuspend: number;
  acSuspend: number;
}

// 默认休眠设置（作为 fallback）
const DEFAULT_SLEEP_SETTINGS: OriginalSleepSettings = {
  batteryIdle: 300,      // 5 分钟
  acIdle: 300,           // 5 分钟
  batterySuspend: 600,   // 10 分钟
  acSuspend: 600,        // 10 分钟
};

const SLEEP_SETTINGS_STORAGE_KEY = "qqmusic_sleep_settings_backup";

function loadStoredSleepSettings(): OriginalSleepSettings | null {
  try {
    // eslint-disable-next-line no-undef
    const raw = localStorage.getItem(SLEEP_SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OriginalSleepSettings>;
    if (
      typeof parsed.batteryIdle === "number" &&
      typeof parsed.acIdle === "number" &&
      typeof parsed.batterySuspend === "number" &&
      typeof parsed.acSuspend === "number"
    ) {
      return {
        batteryIdle: parsed.batteryIdle,
        acIdle: parsed.acIdle,
        batterySuspend: parsed.batterySuspend,
        acSuspend: parsed.acSuspend,
      };
    }
  } catch {
    // ignore
  }
  return null;
}

function saveStoredSleepSettings(settings: OriginalSleepSettings) {
  try {
    // eslint-disable-next-line no-undef
    localStorage.setItem(SLEEP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

function clearStoredSleepSettings() {
  try {
    // eslint-disable-next-line no-undef
    localStorage.removeItem(SLEEP_SETTINGS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// 原始设置（在第一次禁用休眠时保存）
let originalSleepSettings: OriginalSleepSettings | null = null;

// 生成 Protobuf 格式的设置数据
function genSettings(fieldDef: SettingDef, value: number): string {
  const buf: number[] = [];

  let key = (fieldDef.field << 3) | fieldDef.wireType;
  do {
    let b = key & 0x7F;
    key >>>= 7;
    if (key) b |= 0x80;
    buf.push(b);
  } while (key);

  if (fieldDef.wireType === 0) {
    do {
      let b = value & 0x7F;
      value >>>= 7;
      if (value) b |= 0x80;
      buf.push(b);
    } while (value);
    return String.fromCharCode(...buf);
  } else if (fieldDef.wireType === 5) {
    const valueBytes = new Uint8Array(new Float32Array([value]).buffer);
    return String.fromCharCode(...buf, ...valueBytes);
  } else {
    throw new Error('Unsupported wire type');
  }
}

// 获取当前休眠设置
async function getCurrentSleepSettings(): Promise<OriginalSleepSettings> {
  try {
    // @ts-ignore - SteamClient 是全局变量
    // eslint-disable-next-line no-undef
    if (typeof SteamClient !== 'undefined' && SteamClient?.Settings?.GetRegisteredSettings) {
      // @ts-ignore
      // eslint-disable-next-line no-undef
      const settings = await SteamClient.Settings.GetRegisteredSettings();
      console.log("获取到系统休眠设置:", settings);
      // 尝试解析设置，如果失败则使用默认值
      // 注意：这里的解析可能需要根据实际返回格式调整
      if (settings) {
        return {
          batteryIdle: settings.battery_idle ?? DEFAULT_SLEEP_SETTINGS.batteryIdle,
          acIdle: settings.ac_idle ?? DEFAULT_SLEEP_SETTINGS.acIdle,
          batterySuspend: settings.battery_suspend ?? DEFAULT_SLEEP_SETTINGS.batterySuspend,
          acSuspend: settings.ac_suspend ?? DEFAULT_SLEEP_SETTINGS.acSuspend,
        };
      }
    }
  } catch (e) {
    console.warn("获取系统休眠设置失败，使用默认值:", e);
  }
  return { ...DEFAULT_SLEEP_SETTINGS };
}

// 更新系统休眠设置
async function updateSleepSettings(batteryIdle: number, acIdle: number, batterySuspend: number, acSuspend: number) {
  try {
    // @ts-ignore - SteamClient 是全局变量
    // eslint-disable-next-line no-undef
    if (typeof SteamClient === 'undefined' || !SteamClient?.System?.UpdateSettings) {
      console.warn("SteamClient.System.UpdateSettings 不可用");
      return;
    }

    const batteryIdleData = genSettings(SettingDefaults.battery_idle, batteryIdle);
    const acIdleData = genSettings(SettingDefaults.ac_idle, acIdle);
    const batterySuspendData = genSettings(SettingDefaults.battery_suspend, batterySuspend);
    const acSuspendData = genSettings(SettingDefaults.ac_suspend, acSuspend);

    // @ts-ignore
    // eslint-disable-next-line no-undef
    await SteamClient.System.UpdateSettings(window.btoa(batteryIdleData + acIdleData + batterySuspendData + acSuspendData));
  } catch (e) {
    console.error("更新休眠设置失败:", e);
  }
}

// 禁用休眠
async function inhibitSleep() {
  // 第一次禁用时保存原始设置
  if (!originalSleepSettings) {
    originalSleepSettings = await getCurrentSleepSettings();
    saveStoredSleepSettings(originalSleepSettings);
    console.log("保存原始休眠设置:", originalSleepSettings);
  }

  console.log("禁用系统休眠");
  await updateSleepSettings(0, 0, 0, 0);
}

// 恢复休眠（使用保存的原始设置或默认值）
async function uninhibitSleep() {
  const settings = originalSleepSettings || DEFAULT_SLEEP_SETTINGS;
  console.log("恢复系统休眠:", settings);
  await updateSleepSettings(settings.batteryIdle, settings.acIdle, settings.batterySuspend, settings.acSuspend);
  clearStoredSleepSettings();
}

// 全局休眠状态
let sleepInhibited = false;

// 播放队列持久化
const PLAYLIST_STORAGE_KEY = "qqmusic_playlist_state";
const PLAY_MODE_STORAGE_KEY = "qqmusic_play_mode";

interface StoredQueueState {
  playlist: SongInfo[];
  currentIndex: number;
  currentMid?: string;
}

function loadQueueState(): StoredQueueState {
  try {
    // eslint-disable-next-line no-undef
    const raw = localStorage.getItem(PLAYLIST_STORAGE_KEY);
    if (!raw) return { playlist: [], currentIndex: -1 };
    const parsed = JSON.parse(raw) as StoredQueueState;
    if (!Array.isArray(parsed.playlist) || typeof parsed.currentIndex !== "number") {
      return { playlist: [], currentIndex: -1 };
    }
    // 若有 currentMid，优先定位到对应索引
    if (parsed.currentMid) {
      const idx = parsed.playlist.findIndex((s) => s.mid === parsed.currentMid);
      if (idx >= 0) {
        parsed.currentIndex = idx;
      }
    }
    return {
      playlist: parsed.playlist,
      currentIndex: Math.min(Math.max(parsed.currentIndex, -1), parsed.playlist.length - 1),
    };
  } catch {
    return { playlist: [], currentIndex: -1 };
  }
}

function saveQueueState(playlist: SongInfo[], currentIndex: number) {
  try {
    // eslint-disable-next-line no-undef
    localStorage.setItem(
      PLAYLIST_STORAGE_KEY,
      JSON.stringify({
        playlist,
        currentIndex,
        currentMid: playlist[currentIndex]?.mid,
      })
    );
  } catch {
    // ignore
  }
}

function clearQueueState() {
  try {
    // eslint-disable-next-line no-undef
    localStorage.removeItem(PLAYLIST_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function loadPlayMode(): PlayMode {
  try {
    // eslint-disable-next-line no-undef
    const raw = localStorage.getItem(PLAY_MODE_STORAGE_KEY);
    if (raw === "order" || raw === "single" || raw === "shuffle") {
      return raw;
    }
  } catch {
    // ignore
  }
  return "order";
}

function savePlayMode(mode: PlayMode) {
  try {
    // eslint-disable-next-line no-undef
    localStorage.setItem(PLAY_MODE_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

// 全局状态 - 在模块级别创建，不会因组件卸载而销毁
let globalAudio: HTMLAudioElement | null = null;
let globalCurrentSong: SongInfo | null = null;
let globalLyric: ParsedLyric | null = null;
let globalPlaylist: SongInfo[] = [];
let globalCurrentIndex: number = -1;
let globalPlayMode: PlayMode = loadPlayMode();

// 随机播放状态
let shuffleHistory: number[] = [];
let shuffleCursor: number = -1;
let shufflePool: number[] = [];

// 初始化时从本地存储恢复队列
(() => {
  const stored = loadQueueState();
  if (stored.playlist.length > 0) {
    globalPlaylist = stored.playlist;
    globalCurrentIndex = stored.currentIndex >= 0 ? stored.currentIndex : 0;
    globalCurrentSong = globalPlaylist[globalCurrentIndex] || null;
  }
})();

function buildShufflePoolFromHistory(currentIndex: number): number[] {
  const blocked = new Set<number>(shuffleHistory);
  const pool: number[] = [];
  for (let i = 0; i < globalPlaylist.length; i += 1) {
    if (i === currentIndex) continue;
    if (blocked.has(i)) continue;
    pool.push(i);
  }
  return pool;
}

function resetShuffleState(currentIndex: number) {
  if (globalPlaylist.length === 0 || currentIndex < 0) {
    shuffleHistory = [];
    shuffleCursor = -1;
    shufflePool = [];
    return;
  }
  shuffleHistory = [currentIndex];
  shuffleCursor = 0;
  shufflePool = buildShufflePoolFromHistory(currentIndex);
}

function syncShuffleAfterPlaylistChange(currentIndex: number) {
  if (globalPlaylist.length === 0 || currentIndex < 0) {
    resetShuffleState(currentIndex);
    return;
  }

  // 清理无效索引并去重，保证 currentIndex 在历史中
  shuffleHistory = shuffleHistory.filter((idx) => idx >= 0 && idx < globalPlaylist.length);
  const seen = new Set<number>();
  shuffleHistory = shuffleHistory.filter((idx) => {
    if (seen.has(idx)) return false;
    seen.add(idx);
    return true;
  });

  const existingPos = shuffleHistory.indexOf(currentIndex);
  if (existingPos === -1) {
    shuffleHistory = [currentIndex];
    shuffleCursor = 0;
  } else {
    shuffleHistory = shuffleHistory.slice(0, existingPos + 1);
    shuffleCursor = existingPos;
  }

  shufflePool = buildShufflePoolFromHistory(currentIndex);
}

function getShuffleNextIndex(): number | null {
  if (globalPlaylist.length === 0) return null;

  if (shuffleCursor < 0 || shuffleHistory.length === 0) {
    resetShuffleState(globalCurrentIndex >= 0 ? globalCurrentIndex : 0);
  }

  if (shuffleCursor < shuffleHistory.length - 1) {
    shuffleCursor += 1;
    return shuffleHistory[shuffleCursor] ?? null;
  }

  if (shufflePool.length === 0) {
    shufflePool = buildShufflePoolFromHistory(globalCurrentIndex);
  }
  if (shufflePool.length === 0) {
    return globalCurrentIndex >= 0 ? globalCurrentIndex : null;
  }

  const pickedIdx = Math.floor(Math.random() * shufflePool.length);
  const picked = shufflePool.splice(pickedIdx, 1)[0];
  shuffleHistory.push(picked);
  shuffleCursor = shuffleHistory.length - 1;
  return picked ?? null;
}

function getShufflePrevIndex(): number | null {
  if (shuffleCursor > 0) {
    shuffleCursor -= 1;
    return shuffleHistory[shuffleCursor] ?? null;
  }
  return shuffleHistory[0] ?? (globalCurrentIndex >= 0 ? globalCurrentIndex : null);
}

resetShuffleState(globalCurrentIndex);

// 插件非正常退出后尝试恢复系统休眠设置
void (async () => {
  const storedSettings = loadStoredSleepSettings();
  if (!storedSettings) return;
  originalSleepSettings = storedSettings;
  await uninhibitSleep();
})();

// 播放下一首的回调（用于在 ended 事件中调用）
let onPlayNextCallback: (() => void) | null = null;

// 播放列表结束时获取更多歌曲的回调
let onNeedMoreSongsCallback: (() => Promise<SongInfo[]>) | null = null;

// 自动跳过的 timeout ID，用于取消
let skipTimeoutId: ReturnType<typeof setTimeout> | null = null;

// ==================== 缓存 ====================
// 歌曲 URL 缓存 (TTL 30分钟)
const songUrlCache = new Map<string, { url: string, timestamp: number }>();
const CACHE_TTL = 30 * 60 * 1000;

// 歌词缓存 (持久缓存，直到插件重载)
const lyricCache = new Map<string, ParsedLyric>();

// 预取任务缓存，避免重复请求
const prefetchingUrlPromises = new Map<string, Promise<void>>();
const prefetchingLyricPromises = new Map<string, Promise<ParsedLyric | null>>();

// 订阅者：用于在多个 usePlayer 实例间同步状态（侧边栏/全屏等）
const playerSubscribers = new Set<() => void>();

function notifyPlayerSubscribers() {
  playerSubscribers.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });
}

function broadcastPlayerState() {
  notifyPlayerSubscribers();
}

// 统一的歌词获取函数（带缓存/并发复用）
async function fetchLyricWithCache(mid: string, onResolved?: (parsed: ParsedLyric) => void) {
  const cached = lyricCache.get(mid);
  if (cached) {
    onResolved?.(cached);
    globalLyric = cached;
    notifyPlayerSubscribers();
    return cached;
  }

  const existing = prefetchingLyricPromises.get(mid);
  if (existing) {
    await existing;
    const after = lyricCache.get(mid);
    if (after) {
      onResolved?.(after);
      globalLyric = after;
      return after;
    }
    return null;
  }

  const promise = getSongLyric(mid, true)
    .then((res) => {
      if (res.success && res.lyric) {
        const parsed = parseLyric(res.lyric, res.trans);
        lyricCache.set(mid, parsed);
        globalLyric = parsed;
        onResolved?.(parsed);
        notifyPlayerSubscribers();
        return parsed;
      }
      return null;
    })
    .catch(() => null)
    .finally(() => prefetchingLyricPromises.delete(mid));

  prefetchingLyricPromises.set(mid, promise);
  return promise;
}

// 获取或创建全局音频实例
function getGlobalAudio(): HTMLAudioElement {
  if (!globalAudio) {
    globalAudio = new Audio();
    globalAudio.preload = "auto";

    // 设置全局的 ended 事件处理
    globalAudio.addEventListener('ended', () => {
      const shouldAutoContinue =
        globalPlayMode === "single" ||
        globalPlayMode === "shuffle" ||
        globalPlaylist.length > 1 ||
        Boolean(onNeedMoreSongsCallback);

      if (onPlayNextCallback && shouldAutoContinue) {
        onPlayNextCallback();
        return;
      }

      if (sleepInhibited) {
        sleepInhibited = false;
        uninhibitSleep();
      }
    });
  }
  return globalAudio;
}

/**
 * 获取当前音频播放时间（秒）
 * 直接从 Audio 元素获取，用于高频动画更新
 */
export function getAudioCurrentTime(): number {
  return globalAudio?.currentTime || 0;
}

// 预取下一首的播放链接与歌词，减少切歌延迟
async function prefetchSongAssets(song: SongInfo) {
  const tasks: Promise<unknown>[] = [];

  const cachedUrl = songUrlCache.get(song.mid);
  const urlStale = !cachedUrl || Date.now() - cachedUrl.timestamp >= CACHE_TTL;
  if (urlStale && !prefetchingUrlPromises.has(song.mid)) {
    const urlPromise = getSongUrl(song.mid)
      .then((urlResult) => {
        if (urlResult.success && urlResult.url) {
          songUrlCache.set(song.mid, { url: urlResult.url, timestamp: Date.now() });
        }
      })
      .catch(() => { })
      .finally(() => prefetchingUrlPromises.delete(song.mid));

    prefetchingUrlPromises.set(song.mid, urlPromise);
    tasks.push(urlPromise);
  }

  if (!lyricCache.has(song.mid) && !prefetchingLyricPromises.has(song.mid)) {
    const lyricPromise = getSongLyric(song.mid, true)
      .then((lyricResult) => {
        if (lyricResult.success && lyricResult.lyric) {
          const parsed = parseLyric(lyricResult.lyric, lyricResult.trans);
          lyricCache.set(song.mid, parsed);
          return parsed;
        }
        return null;
      })
      .catch(() => null)
      .finally(() => prefetchingLyricPromises.delete(song.mid));

    prefetchingLyricPromises.set(song.mid, lyricPromise);
    tasks.push(lyricPromise);
  }

  if (tasks.length > 0) {
    await Promise.allSettled(tasks);
  }
}

// 全局清理函数 - 用于插件卸载时调用
export function cleanupPlayer() {
  console.log("清理播放器资源");

  // 停止播放
  if (globalAudio) {
    globalAudio.pause();
    globalAudio.src = "";
  }

  // 恢复休眠
  if (sleepInhibited) {
    sleepInhibited = false;
    uninhibitSleep();
  }

  // 清理原始休眠设置
  originalSleepSettings = null;

  // 清理全局状态
  globalCurrentSong = null;
  globalLyric = null;
  globalPlaylist = [];
  globalCurrentIndex = -1;
  shuffleHistory = [];
  shuffleCursor = -1;
  shufflePool = [];
  onPlayNextCallback = null;
  onNeedMoreSongsCallback = null;

  if (skipTimeoutId) {
    clearTimeout(skipTimeoutId);
    skipTimeoutId = null;
  }

  clearStoredSleepSettings();
  clearQueueState();
}

export interface UsePlayerReturn {
  // 状态
  currentSong: SongInfo | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  loading: boolean;
  error: string;
  lyric: ParsedLyric | null;
  playlist: SongInfo[]; // 作为“时间线”：currentIndex 前为历史，之后为未来队列
  currentIndex: number;
  playMode: PlayMode;

  // 方法
  playSong: (song: SongInfo) => Promise<void>; // 插入当前位置并立刻播放
  playPlaylist: (songs: SongInfo[], startIndex?: number) => Promise<void>; // 将列表插入当前位置并从首曲播放
  addToQueue: (songs: SongInfo[]) => Promise<void>; // 追加到队尾，不打断当前播放
  removeFromQueue: (index: number) => void; // 删除未来队列中的歌曲（当前/历史不删除）
  playAtIndex: (index: number) => Promise<void>; // 在当前队列中跳转播放
  togglePlay: () => void;
  seek: (time: number) => void;
  stop: () => void;
  playNext: () => void;
  playPrev: () => void;
  setOnNeedMoreSongs: (callback: (() => Promise<SongInfo[]>) | null) => void;
  cyclePlayMode: () => void;
  setPlayMode: (mode: PlayMode) => void;
}

export function usePlayer(): UsePlayerReturn {
  // 从全局状态初始化
  const [currentSong, setCurrentSong] = useState<SongInfo | null>(globalCurrentSong);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lyric, setLyric] = useState<ParsedLyric | null>(globalLyric);
  const [playlist, setPlaylist] = useState<SongInfo[]>(globalPlaylist);
  const [currentIndex, setCurrentIndex] = useState(globalCurrentIndex);
  const [playMode, setPlayModeState] = useState<PlayMode>(globalPlayMode);

  const syncFromGlobals = useCallback(() => {
    const audio = getGlobalAudio();
    setCurrentSong(globalCurrentSong);
    setLyric(globalLyric);
    setPlaylist([...globalPlaylist]);
    setCurrentIndex(globalCurrentIndex);
    setPlayModeState(globalPlayMode);
    setIsPlaying(!audio.paused);
    setCurrentTime(audio.currentTime);
    setDuration(audio.duration || globalCurrentSong?.duration || 0);
  }, []);

  useEffect(() => {
    playerSubscribers.add(syncFromGlobals);
    return () => {
      playerSubscribers.delete(syncFromGlobals);
    };
  }, [syncFromGlobals]);

  const updatePlayMode = useCallback((mode: PlayMode) => {
    globalPlayMode = mode;
    setPlayModeState(mode);
    savePlayMode(mode);
    if (mode === "shuffle") {
      syncShuffleAfterPlaylistChange(globalCurrentIndex);
    }
    broadcastPlayerState();
  }, []);

  const cyclePlayMode = useCallback(() => {
    const nextMode: PlayMode =
      globalPlayMode === "order" ? "single" : globalPlayMode === "single" ? "shuffle" : "order";
    updatePlayMode(nextMode);
  }, [updatePlayMode]);

  // 内部播放歌曲方法
  const playSongInternal = useCallback(async (song: SongInfo, index: number = -1, autoSkipOnError: boolean = true): Promise<boolean> => {
    const audio = getGlobalAudio();

    // 取消之前的自动跳过 timeout
    if (skipTimeoutId) {
      clearTimeout(skipTimeoutId);
      skipTimeoutId = null;
    }

    const wasSameSong = globalCurrentSong?.mid === song.mid;

    setLoading(true);
    setError("");
    setCurrentSong(song);
    setCurrentTime(0);
    setDuration(song.duration);
    // 如同一首歌且已有歌词，避免重复清空造成 UI 闪烁
    if (!wasSameSong) {
      setLyric(null);
      globalLyric = null;
    } else if (globalLyric) {
      setLyric(globalLyric);
    }

    // 更新全局状态
    globalCurrentSong = song;
    if (index >= 0) {
      globalCurrentIndex = index;
      setCurrentIndex(index);
    }
    saveQueueState(globalPlaylist, globalCurrentIndex);

    try {
      // 1. 获取播放链接 (带缓存)
      let playUrl = "";
      const cachedUrl = songUrlCache.get(song.mid);

      // 检查缓存是否有效
      if (cachedUrl && Date.now() - cachedUrl.timestamp < CACHE_TTL) {
        console.log(`[Player] 使用缓存的 URL: ${song.name}`);
        playUrl = cachedUrl.url;
      } else {
        // 无缓存或已过期，请求 API
        const urlResult = await getSongUrl(song.mid);

        if (!urlResult.success || !urlResult.url) {
          const errorMsg = urlResult.error || "该歌曲暂时无法播放";
          setError(errorMsg);
          setLoading(false);

          toaster.toast({
            title: `⚠️ ${song.name}`,
            body: errorMsg,
          });

          if (autoSkipOnError && globalPlaylist.length > 1) {
            skipTimeoutId = setTimeout(() => {
              skipTimeoutId = null;
              if (onPlayNextCallback) {
                onPlayNextCallback();
              }
            }, 2000);
          }
          return false;
        }

        playUrl = urlResult.url;
        // 写入缓存
        songUrlCache.set(song.mid, { url: playUrl, timestamp: Date.now() });
      }

      audio.src = playUrl;
      audio.load();

      try {
        await audio.play();
        setIsPlaying(true);

        if (!sleepInhibited) {
          sleepInhibited = true;
          inhibitSleep();
        }

        setLoading(false);
      } catch (e) {
        // 播放失败处理 (精简版，复用现有逻辑)
        const errorMsg = (e as Error).message;
        setError(errorMsg);
        setLoading(false);
        toaster.toast({ title: "播放失败", body: errorMsg });

        // 如果是缓存的 URL 导致播放失败（比如通过某种方式过期了但没超时），或许应该清除缓存？
        // 暂时简单处理：如果播放失败，清除该歌曲的 URL 缓存，以便下次重试能获取新的
        songUrlCache.delete(song.mid);

        if (autoSkipOnError && globalPlaylist.length > 1) {
          skipTimeoutId = setTimeout(() => {
            skipTimeoutId = null;
            if (onPlayNextCallback) onPlayNextCallback();
          }, 2000);
        }
        return false;
      }

      // 2. 获取歌词 (带缓存/并发复用)
      if (!wasSameSong || !globalLyric) {
        fetchLyricWithCache(song.mid, setLyric);
      }

      broadcastPlayerState();
      return true;
    } catch (e) {
      const errorMsg = (e as Error).message;
      setError(errorMsg);
      setLoading(false);
      toaster.toast({ title: "播放出错", body: errorMsg });
      return false;
    }
  }, []);

  // 播放下一首
  const playNext = useCallback(async () => {
    if (globalPlaylist.length === 0) return;

    const resolveOrderNext = async (): Promise<number | null> => {
      let nextIndex = globalCurrentIndex + 1;
      if (nextIndex >= globalPlaylist.length) {
        if (onNeedMoreSongsCallback) {
          try {
            const moreSongs = await onNeedMoreSongsCallback();
            if (moreSongs && moreSongs.length > 0) {
              const insertPos = globalCurrentIndex + 1;
              globalPlaylist.splice(insertPos, 0, ...moreSongs);
              setPlaylist([...globalPlaylist]);
              nextIndex = insertPos;
            } else {
              return null; // 没有更多歌曲，停止
            }
          } catch (e) {
            console.error("获取更多歌曲失败:", e);
            return null;
          }
        } else {
          return null; // 队列结束，停止
        }
      }
      return nextIndex;
    };

    let targetIndex: number | null = null;
    if (globalPlayMode === "single") {
      targetIndex = globalCurrentIndex;
    } else if (globalPlayMode === "shuffle") {
      targetIndex = getShuffleNextIndex();
    } else {
      targetIndex = await resolveOrderNext();
    }

    if (targetIndex === null || targetIndex < 0 || targetIndex >= globalPlaylist.length) {
      return;
    }

    const nextSong = globalPlaylist[targetIndex];
    if (globalPlayMode === "shuffle") {
      syncShuffleAfterPlaylistChange(targetIndex);
    }
    if (nextSong) {
      // 播放下一首时，如果失败也自动跳过
      playSongInternal(nextSong, targetIndex, true);
      prefetchSongAssets(globalPlaylist[targetIndex + 1] || nextSong);
      saveQueueState(globalPlaylist, globalCurrentIndex);
      broadcastPlayerState();
    }
  }, [playSongInternal]);

  // 播放上一首
  const playPrev = useCallback(() => {
    if (globalPlaylist.length === 0) return;

    let targetIndex: number | null = null;
    if (globalPlayMode === "single") {
      targetIndex = globalCurrentIndex;
    } else if (globalPlayMode === "shuffle") {
      targetIndex = getShufflePrevIndex();
    } else {
      const prevIndex = globalCurrentIndex - 1;
      targetIndex = prevIndex >= 0 ? prevIndex : null;
    }

    if (targetIndex === null || targetIndex < 0 || targetIndex >= globalPlaylist.length) {
      return;
    }

    if (globalPlayMode === "shuffle") {
      syncShuffleAfterPlaylistChange(targetIndex);
    }

    const prevSong = globalPlaylist[targetIndex];
    if (prevSong) {
      playSongInternal(prevSong, targetIndex, true);
    }
  }, [playSongInternal]);

  // 注册播放下一首的回调
  useEffect(() => {
    onPlayNextCallback = playNext;
    return () => {
      // 不要清除回调，因为我们需要在组件卸载后也能自动播放下一首
    };
  }, [playNext]);

  // 同步全局音频状态到本地状态
  useEffect(() => {
    const audio = getGlobalAudio();

    // 恢复已有的播放状态
    if (globalCurrentSong) {
      setCurrentSong(globalCurrentSong);
      setLyric(globalLyric);
      setIsPlaying(!audio.paused);
      setCurrentTime(audio.currentTime);
      setDuration(audio.duration || globalCurrentSong.duration);

      // 如果没有缓存歌词，尝试拉取
      if (!globalLyric) {
        fetchLyricWithCache(globalCurrentSong.mid, setLyric);
      }
    }
    setPlaylist(globalPlaylist);
    setCurrentIndex(globalCurrentIndex);

    // 设置事件监听
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleDurationChange = () => setDuration(audio.duration || 0);
    const handleCanPlay = () => setLoading(false);
    const handleError = () => {
      setError("音频加载失败");
      setLoading(false);
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('error', handleError);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);

    // 清理时只移除事件监听，不停止播放
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
    };
  }, []);

  // 播放单曲（会清空播放列表）
  const playSong = useCallback(async (song: SongInfo) => {
    if (!globalCurrentSong || globalCurrentIndex < 0) {
      globalPlaylist = [song];
      globalCurrentIndex = 0;
      setPlaylist([song]);
      setCurrentIndex(0);
      syncShuffleAfterPlaylistChange(0);
      await playSongInternal(song, 0);
      return;
    }

    // 保证时间线唯一：保留当前曲，移除其他相同 mid
    const filtered = globalPlaylist.filter((s, idx) => s.mid !== song.mid || idx === globalCurrentIndex);

    const past = filtered.slice(0, globalCurrentIndex + 1); // 含当前曲
    const future = filtered.slice(globalCurrentIndex + 1);
    globalPlaylist = [...past, song, ...future];
    const newIndex = past.length;
    globalCurrentIndex = newIndex;
    setPlaylist([...globalPlaylist]);
    setCurrentIndex(newIndex);
    syncShuffleAfterPlaylistChange(newIndex);
    saveQueueState(globalPlaylist, globalCurrentIndex);
    await playSongInternal(song, newIndex);
    prefetchSongAssets(globalPlaylist[newIndex + 1] || globalPlaylist[newIndex]);
    broadcastPlayerState();
  }, [playSongInternal]);

  // 播放整个播放列表：插入当前位置，播放首曲，之后继续原队列
  const playPlaylist = useCallback(async (songs: SongInfo[], startIndex: number = 0) => {
    if (songs.length === 0) return;

    if (!globalCurrentSong || globalCurrentIndex < 0) {
      globalPlaylist = songs;
      globalCurrentIndex = startIndex;
      setPlaylist([...songs]);
      setCurrentIndex(startIndex);
      syncShuffleAfterPlaylistChange(startIndex);
      await playSongInternal(songs[startIndex], startIndex);
      prefetchSongAssets(songs[startIndex + 1] || songs[startIndex]);
      return;
    }

    // 去重后插入：保留当前曲，时间线唯一
    const currentMid = globalPlaylist[globalCurrentIndex].mid;
    const seen = new Set<string>([currentMid]);
    const cleaned = globalPlaylist.filter((s, idx) => {
      if (idx === globalCurrentIndex) return true; // 当前曲保留
      if (seen.has(s.mid)) return false;
      seen.add(s.mid);
      return true;
    });

    const songsToInsert = songs.filter((s) => {
      if (seen.has(s.mid)) return false;
      seen.add(s.mid);
      return true;
    });

    if (songsToInsert.length === 0) {
      globalPlaylist = cleaned;
      setPlaylist([...cleaned]);
      saveQueueState(globalPlaylist, globalCurrentIndex);
      broadcastPlayerState();
      return;
    }

    const past = cleaned.slice(0, globalCurrentIndex + 1); // 含当前曲
    const future = cleaned.slice(globalCurrentIndex + 1);
    const clampedStartIndex = Math.min(Math.max(startIndex, 0), songsToInsert.length - 1);
    globalPlaylist = [...past, ...songsToInsert, ...future];
    const newIndex = past.length + clampedStartIndex;
    globalCurrentIndex = newIndex;
    setPlaylist([...globalPlaylist]);
    setCurrentIndex(newIndex);
    syncShuffleAfterPlaylistChange(newIndex);
    saveQueueState(globalPlaylist, globalCurrentIndex);
    await playSongInternal(globalPlaylist[newIndex], newIndex);
    prefetchSongAssets(globalPlaylist[newIndex + 1] || globalPlaylist[newIndex]);
    broadcastPlayerState();
  }, [playSongInternal]);

  // 追加歌曲到队列（不打断当前播放；无播放时自动开始）
  const addToQueue = useCallback(async (songs: SongInfo[]) => {
    if (songs.length === 0) return;
    const existingMids = new Set(globalPlaylist.map((s) => s.mid));
    const songsToAdd = songs.filter((s) => !existingMids.has(s.mid));
    if (songsToAdd.length === 0) return;

    const prevLength = globalPlaylist.length;
    const newPlaylist = [...globalPlaylist, ...songsToAdd];
    globalPlaylist = newPlaylist;
    setPlaylist(newPlaylist);
    if (globalPlayMode === "shuffle") {
      const blocked = new Set(shuffleHistory);
      songsToAdd.forEach((_, idx) => {
        const newIndex = prevLength + idx;
        if (!blocked.has(newIndex) && !shufflePool.includes(newIndex) && newIndex !== globalCurrentIndex) {
          shufflePool.push(newIndex);
        }
      });
    }
    saveQueueState(globalPlaylist, globalCurrentIndex);
    broadcastPlayerState();

    // 如果当前没有播放，自动开始播放追加的第一首
    if (!globalCurrentSong || globalCurrentIndex < 0) {
      globalCurrentIndex = 0;
      setCurrentIndex(globalCurrentIndex);
      syncShuffleAfterPlaylistChange(0);
      await playSongInternal(newPlaylist[0], 0);
      broadcastPlayerState();
    }
  }, [playSongInternal]);

  // 删除未来队列中的歌曲
  const removeFromQueue = useCallback((index: number) => {
    if (index <= globalCurrentIndex) return; // 不删除当前/历史
    if (index < 0 || index >= globalPlaylist.length) return;
    globalPlaylist.splice(index, 1);
    if (globalPlayMode === "shuffle") {
      shuffleHistory = shuffleHistory
        .filter((idx) => idx !== index)
        .map((idx) => (idx > index ? idx - 1 : idx));
      shufflePool = shufflePool
        .filter((idx) => idx !== index)
        .map((idx) => (idx > index ? idx - 1 : idx));
      shuffleCursor = Math.min(shuffleCursor, shuffleHistory.length - 1);
      syncShuffleAfterPlaylistChange(globalCurrentIndex);
    }
    setPlaylist([...globalPlaylist]);
    saveQueueState(globalPlaylist, globalCurrentIndex);
    broadcastPlayerState();
  }, []);

  const togglePlay = useCallback(() => {
    const audio = getGlobalAudio();

    // 若无音频源但已有当前歌曲（例如重启后恢复状态），重新加载并播放
    const resumeSong = globalCurrentSong;
    if (!audio.src && resumeSong) {
      const resumeIndex = globalCurrentIndex >= 0 ? globalCurrentIndex : 0;
      void playSongInternal(resumeSong, resumeIndex, false);
      return;
    }

    if (isPlaying) {
      audio.pause();
      // 恢复休眠
      if (sleepInhibited) {
        sleepInhibited = false;
        uninhibitSleep();
      }
    } else {
      audio.play().then(() => {
        // 禁用休眠
        if (!sleepInhibited) {
          sleepInhibited = true;
          inhibitSleep();
        }
      }).catch(e => {
        toaster.toast({
          title: "播放失败",
          body: e.message
        });
      });
    }
  }, [isPlaying, playSongInternal]);

  const seek = useCallback((time: number) => {
    const audio = getGlobalAudio();
    if (audio.duration) {
      const clampedTime = Math.max(0, Math.min(time, audio.duration));
      audio.currentTime = clampedTime;
      setCurrentTime(clampedTime);
    }
  }, []);

  const stop = useCallback(() => {
    const audio = getGlobalAudio();
    audio.pause();
    audio.src = "";

    // 取消自动跳过 timeout
    if (skipTimeoutId) {
      clearTimeout(skipTimeoutId);
      skipTimeoutId = null;
    }

    // 恢复休眠
    if (sleepInhibited) {
      sleepInhibited = false;
      uninhibitSleep();
    }

    // 清理全局状态
    globalCurrentSong = null;
    globalLyric = null;
    globalPlaylist = [];
    globalCurrentIndex = -1;
    onNeedMoreSongsCallback = null;

    setCurrentSong(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setError("");
    setLyric(null);
    setPlaylist([]);
    setCurrentIndex(-1);
    saveQueueState([], -1);
    broadcastPlayerState();
  }, []);

  // 跳转到当前队列中的指定索引播放
  const playAtIndex = useCallback(async (index: number) => {
    if (index < 0 || index >= globalPlaylist.length) return;
    if (globalPlayMode === "shuffle") {
      const existingPos = shuffleHistory.indexOf(index);
      if (existingPos >= 0) {
        shuffleHistory = shuffleHistory.slice(0, existingPos + 1);
        shuffleCursor = existingPos;
      } else {
        shuffleHistory = shuffleHistory.slice(0, Math.max(shuffleCursor, 0) + 1);
        shuffleHistory.push(index);
        shuffleCursor = shuffleHistory.length - 1;
      }
      shufflePool = buildShufflePoolFromHistory(index);
    }
    globalCurrentIndex = index;
    setCurrentIndex(index);
    saveQueueState(globalPlaylist, globalCurrentIndex);
    const song = globalPlaylist[index];
    await playSongInternal(song, index, true);
    prefetchSongAssets(globalPlaylist[index + 1] || song);
    broadcastPlayerState();
  }, [playSongInternal]);

  // 设置获取更多歌曲的回调
  const setOnNeedMoreSongs = useCallback((callback: (() => Promise<SongInfo[]>) | null) => {
    onNeedMoreSongsCallback = callback;
  }, []);

  // 刷新播放历史（从存储重新加载）
  return {
    currentSong,
    isPlaying,
    currentTime,
    duration,
    loading,
    error,
    lyric,
    playlist,
    currentIndex,
    playMode,
    playSong,
    playPlaylist,
    addToQueue,
    playAtIndex,
    togglePlay,
    seek,
    stop,
    playNext,
    playPrev,
    removeFromQueue,
    setOnNeedMoreSongs,
    cyclePlayMode,
    setPlayMode: updatePlayMode,
  };
}

/**
 * 播放器状态管理 Hook
 * 使用全局 Audio 单例，确保关闭面板后音乐继续播放
 * 支持播放列表和自动播放下一首
 * 支持播放历史记录
 * 支持播放时禁止系统休眠
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { toaster } from "@decky/api";
import { getSongUrl, getSongLyric, getFrontendSettings, saveFrontendSettings, getProviderInfo } from "../api";
import type { FrontendSettings, PlayMode, SongInfo, PreferredQuality, StoredQueueState } from "../types";
import { parseLyric, type ParsedLyric } from "../utils/lyricParser";

// ... (keep sleep settings as is)
// ==================== 休眠控制 ====================
// 参考 DeckyInhibitScreenSaver 实现
// ... (keep SettingDefaults and helper functions)

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
  batteryIdle: 300, // 5 分钟
  acIdle: 300, // 5 分钟
  batterySuspend: 600, // 10 分钟
  acSuspend: 600, // 10 分钟
};

const DEFAULT_PREFERRED_QUALITY: PreferredQuality = "auto";

// 原始设置（在第一次禁用休眠时保存）
let originalSleepSettings: OriginalSleepSettings | null = null;
function loadStoredSleepSettings(): OriginalSleepSettings | null {
  const stored = frontendSettings.sleepBackup;
  if (
    stored &&
    typeof stored.batteryIdle === "number" &&
    typeof stored.acIdle === "number" &&
    typeof stored.batterySuspend === "number" &&
    typeof stored.acSuspend === "number"
  ) {
    return stored;
  }
  return null;
}

function saveStoredSleepSettings(settings: OriginalSleepSettings) {
  updateFrontendSettingsCache({ sleepBackup: settings });
}

function clearStoredSleepSettings() {
  updateFrontendSettingsCache({ sleepBackup: undefined });
}

// 生成 Protobuf 格式的设置数据
function genSettings(fieldDef: SettingDef, value: number): string {
  const buf: number[] = [];

  let key = (fieldDef.field << 3) | fieldDef.wireType;
  do {
    let b = key & 0x7f;
    key >>>= 7;
    if (key) b |= 0x80;
    buf.push(b);
  } while (key);

  if (fieldDef.wireType === 0) {
    do {
      let b = value & 0x7f;
      value >>>= 7;
      if (value) b |= 0x80;
      buf.push(b);
    } while (value);
    return String.fromCharCode(...buf);
  } else if (fieldDef.wireType === 5) {
    const valueBytes = new Uint8Array(new Float32Array([value]).buffer);
    return String.fromCharCode(...buf, ...valueBytes);
  } else {
    throw new Error("Unsupported wire type");
  }
}

// 获取当前休眠设置
async function getCurrentSleepSettings(): Promise<OriginalSleepSettings> {
  try {
    // @ts-ignore - SteamClient 是全局变量
    // eslint-disable-next-line no-undef
    if (typeof SteamClient !== "undefined" && SteamClient?.Settings?.GetRegisteredSettings) {
      // @ts-ignore
      // eslint-disable-next-line no-undef
      const settings = await SteamClient.Settings.GetRegisteredSettings();
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
async function updateSleepSettings(
  batteryIdle: number,
  acIdle: number,
  batterySuspend: number,
  acSuspend: number
) {
  try {
    // @ts-ignore - SteamClient 是全局变量
    // eslint-disable-next-line no-undef
    if (typeof SteamClient === "undefined" || !SteamClient?.System?.UpdateSettings) {
      console.warn("SteamClient.System.UpdateSettings 不可用");
      return;
    }

    const batteryIdleData = genSettings(SettingDefaults.battery_idle, batteryIdle);
    const acIdleData = genSettings(SettingDefaults.ac_idle, acIdle);
    const batterySuspendData = genSettings(SettingDefaults.battery_suspend, batterySuspend);
    const acSuspendData = genSettings(SettingDefaults.ac_suspend, acSuspend);

    // @ts-ignore
    // eslint-disable-next-line no-undef
    await SteamClient.System.UpdateSettings(
      window.btoa(batteryIdleData + acIdleData + batterySuspendData + acSuspendData)
    );
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
  }

  await updateSleepSettings(0, 0, 0, 0);
}

// 恢复休眠（使用保存的原始设置或默认值）
async function uninhibitSleep() {
  const settings = originalSleepSettings || DEFAULT_SLEEP_SETTINGS;
  await updateSleepSettings(
    settings.batteryIdle,
    settings.acIdle,
    settings.batterySuspend,
    settings.acSuspend
  );
  clearStoredSleepSettings();
}

// 全局休眠状态
let sleepInhibited = false;

// 设置缓存
let frontendSettings: FrontendSettings = {};
let frontendSettingsLoaded = false;
let frontendSettingsPromise: Promise<void> | null = null;
let frontendSaveEnabled = true;

async function ensureFrontendSettingsLoaded() {
  if (frontendSettingsLoaded) return;
  if (frontendSettingsPromise) {
    await frontendSettingsPromise;
    return;
  }
  frontendSettingsPromise = getFrontendSettings()
    .then((res) => {
      if (res?.success && res.settings) {
        frontendSettings = { ...res.settings };
      }
      if (!frontendSettings.preferredQuality) {
        frontendSettings.preferredQuality = DEFAULT_PREFERRED_QUALITY;
      }
      frontendSettingsLoaded = true;
    })
    .catch(() => {
      frontendSettingsLoaded = true;
    })
    .finally(() => {
      frontendSettingsPromise = null;
    });
  await frontendSettingsPromise;
}

function updateFrontendSettingsCache(
  partial: Partial<FrontendSettings>,
  commit: boolean = true
) {
  frontendSettings = { ...frontendSettings, ...partial };
  if (commit && frontendSaveEnabled) {
    void saveFrontendSettings(frontendSettings as Record<string, unknown>);
  }
}

function getPreferredQuality(): PreferredQuality {
  const pref = frontendSettings.preferredQuality;
  if (pref === "high" || pref === "balanced" || pref === "compat" || pref === "auto") {
    return pref;
  }
  return DEFAULT_PREFERRED_QUALITY;
}

// === 队列状态管理 (按 Provider 隔离) ===

// 获取当前 provider 的队列状态
function loadQueueStateFromSettings(providerId: string): StoredQueueState {
  const queues = frontendSettings.providerQueues || {};
  const stored = queues[providerId];
  
  if (!stored) return { playlist: [], currentIndex: -1 };
  
  const playlist = Array.isArray(stored.playlist) ? stored.playlist : [];
  const currentIndex = typeof stored.currentIndex === "number" ? stored.currentIndex : -1;
  const currentMid = stored.currentMid;
  
  if (currentMid) {
    const idx = playlist.findIndex((s) => s.mid === currentMid);
    if (idx >= 0) {
      return { playlist, currentIndex: idx, currentMid };
    }
  }
  
  return {
    playlist,
    currentIndex: Math.min(Math.max(currentIndex, -1), Math.max(playlist.length - 1, -1)),
  };
}

// 保存当前 provider 的队列状态
function saveQueueState(providerId: string, playlist: SongInfo[], currentIndex: number) {
  if (!providerId) return;
  
  const currentQueues = frontendSettings.providerQueues || {};
  const newQueue: StoredQueueState = {
    playlist,
    currentIndex,
    currentMid: playlist[currentIndex]?.mid,
  };
  
  updateFrontendSettingsCache({
    providerQueues: {
      ...currentQueues,
      [providerId]: newQueue
    }
  });
}

function clearQueueState(providerId: string) {
  if (!providerId) return;
  
  const currentQueues = frontendSettings.providerQueues || {};
  updateFrontendSettingsCache({
    providerQueues: {
      ...currentQueues,
      [providerId]: { playlist: [], currentIndex: -1 }
    }
  });
}

function loadPlayMode(): PlayMode {
  const raw = frontendSettings.playMode;
  if (raw === "order" || raw === "single" || raw === "shuffle") {
    return raw;
  }
  return "order";
}

function savePlayMode(mode: PlayMode) {
  updateFrontendSettingsCache({ playMode: mode });
}

function loadVolume(): number {
  const value = frontendSettings.volume;
  if (typeof value === "number") {
    return Math.min(1, Math.max(0, value));
  }
  return 1;
}

function saveVolume(volume: number) {
  updateFrontendSettingsCache({ volume });
}

// 全局状态 - 在模块级别创建，不会因组件卸载而销毁
let globalAudio: HTMLAudioElement | null = null;
let globalCurrentSong: SongInfo | null = null;
let globalLyric: ParsedLyric | null = null;
let globalPlaylist: SongInfo[] = [];
let globalCurrentIndex: number = -1;
let globalPlayMode: PlayMode = loadPlayMode();
let globalVolume: number = loadVolume();
let globalCurrentProviderId: string = ""; // 当前激活的 Provider ID

// 随机播放状态
let shuffleHistory: number[] = [];
let shuffleCursor: number = -1;
let shufflePool: number[] = [];

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

// 播放下一首的回调（用于在 ended 事件中调用）
let onPlayNextCallback: (() => void) | null = null;

// 播放列表结束时获取更多歌曲的回调
let onNeedMoreSongsCallback: (() => Promise<SongInfo[]>) | null = null;

// 自动跳过的 timeout ID，用于取消
let skipTimeoutId: ReturnType<typeof setTimeout> | null = null;

// ==================== 缓存 ====================
// 歌曲 URL 缓存 (TTL 30分钟)
const songUrlCache = new Map<string, { url: string; timestamp: number }>();
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
async function fetchLyricWithCache(
  mid: string,
  songName?: string,
  singer?: string,
  onResolved?: (parsed: ParsedLyric) => void
) {
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

  const promise = getSongLyric(mid, true, songName, singer)
    .then((res) => {
      if (res.success && res.lyric) {
        const parsed = parseLyric(res.lyric, res.trans);
        lyricCache.set(mid, parsed);
        globalLyric = parsed;
        onResolved?.(parsed);
        notifyPlayerSubscribers();
        if (res.fallback_provider) {
          toaster.toast({
            title: "歌词来源",
            body: `已从 ${res.fallback_provider} 获取歌词`,
          });
        }
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
    globalAudio.volume = globalVolume;

    // 设置全局的 ended 事件处理
    globalAudio.addEventListener("ended", () => {
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
    const urlPromise = getSongUrl(song.mid, getPreferredQuality(), song.name, song.singer)
      .then((urlResult) => {
        if (urlResult.success && urlResult.url) {
          songUrlCache.set(song.mid, { url: urlResult.url, timestamp: Date.now() });
        }
      })
      .catch(() => {})
      .finally(() => prefetchingUrlPromises.delete(song.mid));

    prefetchingUrlPromises.set(song.mid, urlPromise);
    tasks.push(urlPromise);
  }

  if (!lyricCache.has(song.mid) && !prefetchingLyricPromises.has(song.mid)) {
    const lyricPromise = getSongLyric(song.mid, true, song.name, song.singer)
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
  globalCurrentProviderId = "";

  if (skipTimeoutId) {
    clearTimeout(skipTimeoutId);
    skipTimeoutId = null;
  }

  clearStoredSleepSettings();
  // 注意：这里不再自动清除队列，而是依赖 providerId 清除或保留
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
  volume: number;
  settingsRestored: boolean;
  currentProviderId: string;

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
  setVolume: (volume: number, options?: { commit?: boolean }) => void;
  enableSettingsSave: (enabled: boolean) => void; // 控制是否允许写入前端设置
  resetAllState: () => void; // 清空内存状态和设置缓存
  clearCurrentQueue: () => void; // 清空当前 provider 的队列
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
  const [volume, setVolumeState] = useState(globalVolume);
  const [settingsRestored, setSettingsRestored] = useState(false);
  const [currentProviderId, setCurrentProviderId] = useState(globalCurrentProviderId);

  // 监听全局状态变化
  const syncFromGlobals = useCallback(() => {
    const audio = getGlobalAudio();
    setCurrentSong(globalCurrentSong);
    setLyric(globalLyric);
    setPlaylist([...globalPlaylist]);
    setCurrentIndex(globalCurrentIndex);
    setPlayModeState(globalPlayMode);
    setVolumeState(globalVolume);
    setIsPlaying(!audio.paused);
    setCurrentTime(audio.currentTime);
    setDuration(audio.duration || globalCurrentSong?.duration || 0);
    setCurrentProviderId(globalCurrentProviderId);
  }, []);

  useEffect(() => {
    playerSubscribers.add(syncFromGlobals);
    return () => {
      playerSubscribers.delete(syncFromGlobals);
    };
  }, [syncFromGlobals]);

  // 初始化：获取 Provider 并恢复队列
  useEffect(() => {
    if (settingsRestored) return;
    
    let cancelled = false;
    void (async () => {
      await ensureFrontendSettingsLoaded();
      if (cancelled) return;

      // 1. 获取当前 Provider
      const providerRes = await getProviderInfo();
      if (!providerRes.success || !providerRes.provider) {
        // 获取失败，稍后重试或保持默认
        setSettingsRestored(true);
        return;
      }
      
      const newProviderId = providerRes.provider.id;
      globalCurrentProviderId = newProviderId;
      setCurrentProviderId(newProviderId);

      // 2. 检查是否需要恢复队列（仅当全局队列为空时，避免覆盖正在播放的）
      if (globalPlaylist.length === 0) {
        const stored = loadQueueStateFromSettings(newProviderId);
        if (stored.playlist.length > 0) {
          globalPlaylist = stored.playlist;
          globalCurrentIndex = stored.currentIndex >= 0 ? stored.currentIndex : 0;
          globalCurrentSong = globalPlaylist[globalCurrentIndex] || null;
          
          setPlaylist([...globalPlaylist]);
          setCurrentIndex(globalCurrentIndex);
          setCurrentSong(globalCurrentSong);
        }
      }

      // 3. 恢复通用设置
      globalPlayMode = loadPlayMode();
      setPlayModeState(globalPlayMode);

      const restoredVolume = loadVolume();
      globalVolume = restoredVolume;
      const audio = getGlobalAudio();
      audio.volume = restoredVolume;
      setVolumeState(restoredVolume);

      setSettingsRestored(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [settingsRestored]);

  // 监听 Provider 变化 (轮询检查，或由外部触发)
  // 实际上 usePlayer 不应该负责监听 provider 变化，而是应该响应变化。
  // 这里我们假设应用层会在 switch provider 后触发一次重载或刷新，或者我们添加一个 check
  
  // 简单起见，我们导出一个切换 provider 后的处理函数，或者在 useProvider 中触发
  // 这里我们增加一个 interval 检查 provider id 是否变化（作为兜底），
  // 更优雅的方式是在 useAppLogic 中 switchProvider 后调用 player.reloadQueue()
  
  // 重启后从存储恢复歌曲时自动拉取歌词
  useEffect(() => {
    if (!settingsRestored) return;
    if (!currentSong) return;
    if (lyric) return;
    fetchLyricWithCache(currentSong.mid, currentSong.name, currentSong.singer, setLyric);
  }, [currentSong, lyric, settingsRestored]);

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

  const setVolume = useCallback((value: number, options?: { commit?: boolean }) => {
    const clamped = Math.min(1, Math.max(0, value));
    globalVolume = clamped;
    const audio = getGlobalAudio();
    if (audio.volume !== clamped) {
      audio.volume = clamped;
    }

    if (options?.commit) {
      saveVolume(clamped);
      broadcastPlayerState();
    }
    setVolumeState(clamped);
  }, []);

  // 内部播放歌曲方法
  const playSongInternal = useCallback(
    async (
      song: SongInfo,
      index: number = -1,
      autoSkipOnError: boolean = true
    ): Promise<boolean> => {
      const audio = getGlobalAudio();

      if (skipTimeoutId) {
        clearTimeout(skipTimeoutId);
        skipTimeoutId = null;
      }

      const wasSameSong = globalCurrentSong?.mid === song.mid;
      const cachedLyric = lyricCache.get(song.mid) || null;
      const hasAnyLyric = Boolean(globalLyric) || Boolean(cachedLyric);

      setLoading(true);
      setError("");
      setCurrentSong(song);
      setCurrentTime(0);
      setDuration(song.duration);
      
      if (!wasSameSong) {
        setLyric(null);
        globalLyric = null;
      } else if (globalLyric) {
        setLyric(globalLyric);
      }

      globalCurrentSong = song;
      if (index >= 0) {
        globalCurrentIndex = index;
        setCurrentIndex(index);
      }
      
      // 保存队列时带上 providerId
      saveQueueState(globalCurrentProviderId, globalPlaylist, globalCurrentIndex);

      try {
        let playUrl = "";
        const cachedUrl = songUrlCache.get(song.mid);

        if (cachedUrl && Date.now() - cachedUrl.timestamp < CACHE_TTL) {
          playUrl = cachedUrl.url;
        } else {
          const urlResult = await getSongUrl(
            song.mid,
            getPreferredQuality(),
            song.name,
            song.singer
          );

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

          if (urlResult.fallback_provider) {
            toaster.toast({
              title: "备用音源",
              body: `已从 ${urlResult.fallback_provider} 获取`,
            });
          }

          playUrl = urlResult.url;
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
          const errorMsg = (e as Error).message;
          setError(errorMsg);
          setLoading(false);
          toaster.toast({ title: "播放失败", body: errorMsg });
          songUrlCache.delete(song.mid);

          if (autoSkipOnError && globalPlaylist.length > 1) {
            skipTimeoutId = setTimeout(() => {
              skipTimeoutId = null;
              if (onPlayNextCallback) onPlayNextCallback();
            }, 2000);
          }
          return false;
        }

        if (!hasAnyLyric) {
          fetchLyricWithCache(song.mid, song.name, song.singer, setLyric);
        } else if (!globalLyric && cachedLyric) {
          globalLyric = cachedLyric;
          setLyric(cachedLyric);
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
    },
    []
  );

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
              return null;
            }
          } catch (e) {
            console.error("获取更多歌曲失败:", e);
            return null;
          }
        } else {
          return null;
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
      playSongInternal(nextSong, targetIndex, true);
      prefetchSongAssets(globalPlaylist[targetIndex + 1] || nextSong);
      saveQueueState(globalCurrentProviderId, globalPlaylist, globalCurrentIndex);
      broadcastPlayerState();
    }
  }, [playSongInternal]);

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

  useEffect(() => {
    onPlayNextCallback = playNext;
    return () => {};
  }, [playNext]);

  const playSong = useCallback(
    async (song: SongInfo) => {
      if (!globalCurrentSong || globalCurrentIndex < 0) {
        globalPlaylist = [song];
        globalCurrentIndex = 0;
        setPlaylist([song]);
        setCurrentIndex(0);
        syncShuffleAfterPlaylistChange(0);
        await playSongInternal(song, 0);
        return;
      }

      const filtered = globalPlaylist.filter(
        (s, idx) => s.mid !== song.mid || idx === globalCurrentIndex
      );

      const past = filtered.slice(0, globalCurrentIndex + 1);
      const future = filtered.slice(globalCurrentIndex + 1);
      globalPlaylist = [...past, song, ...future];
      const newIndex = past.length;
      globalCurrentIndex = newIndex;
      setPlaylist([...globalPlaylist]);
      setCurrentIndex(newIndex);
      syncShuffleAfterPlaylistChange(newIndex);
      saveQueueState(globalCurrentProviderId, globalPlaylist, globalCurrentIndex);
      await playSongInternal(song, newIndex);
      prefetchSongAssets(globalPlaylist[newIndex + 1] || globalPlaylist[newIndex]);
      broadcastPlayerState();
    },
    [playSongInternal]
  );

  const playPlaylist = useCallback(
    async (songs: SongInfo[], startIndex: number = 0) => {
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

      const currentMid = globalPlaylist[globalCurrentIndex].mid;
      const seen = new Set<string>([currentMid]);
      const cleaned = globalPlaylist.filter((s, idx) => {
        if (idx === globalCurrentIndex) return true;
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
        const clampedStartIndex = Math.min(Math.max(startIndex, 0), songs.length - 1);
        const targetMid = songs[clampedStartIndex]?.mid;
        const targetIndex = cleaned.findIndex((s) => s.mid === targetMid);

        if (targetIndex < 0) {
          globalPlaylist = cleaned;
          setPlaylist([...cleaned]);
          saveQueueState(globalCurrentProviderId, globalPlaylist, globalCurrentIndex);
          broadcastPlayerState();
          return;
        }

        globalPlaylist = cleaned;
        globalCurrentIndex = targetIndex;
        setPlaylist([...cleaned]);
        setCurrentIndex(targetIndex);
        syncShuffleAfterPlaylistChange(targetIndex);
        saveQueueState(globalCurrentProviderId, globalPlaylist, globalCurrentIndex);
        await playSongInternal(globalPlaylist[targetIndex], targetIndex);
        prefetchSongAssets(globalPlaylist[targetIndex + 1] || globalPlaylist[targetIndex]);
        broadcastPlayerState();
        return;
      }

      const past = cleaned.slice(0, globalCurrentIndex + 1);
      const future = cleaned.slice(globalCurrentIndex + 1);
      const clampedStartIndex = Math.min(Math.max(startIndex, 0), songsToInsert.length - 1);
      globalPlaylist = [...past, ...songsToInsert, ...future];
      const newIndex = past.length + clampedStartIndex;
      globalCurrentIndex = newIndex;
      setPlaylist([...globalPlaylist]);
      setCurrentIndex(newIndex);
      syncShuffleAfterPlaylistChange(newIndex);
      saveQueueState(globalCurrentProviderId, globalPlaylist, globalCurrentIndex);
      await playSongInternal(globalPlaylist[newIndex], newIndex);
      prefetchSongAssets(globalPlaylist[newIndex + 1] || globalPlaylist[newIndex]);
      broadcastPlayerState();
    },
    [playSongInternal]
  );

  const addToQueue = useCallback(
    async (songs: SongInfo[]) => {
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
          if (
            !blocked.has(newIndex) &&
            !shufflePool.includes(newIndex) &&
            newIndex !== globalCurrentIndex
          ) {
            shufflePool.push(newIndex);
          }
        });
      }
      saveQueueState(globalCurrentProviderId, globalPlaylist, globalCurrentIndex);
      broadcastPlayerState();

      if (!globalCurrentSong || globalCurrentIndex < 0) {
        globalCurrentIndex = 0;
        setCurrentIndex(globalCurrentIndex);
        syncShuffleAfterPlaylistChange(0);
        await playSongInternal(newPlaylist[0], 0);
        broadcastPlayerState();
      }
    },
    [playSongInternal]
  );

  const removeFromQueue = useCallback((index: number) => {
    if (index <= globalCurrentIndex) return;
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
    saveQueueState(globalCurrentProviderId, globalPlaylist, globalCurrentIndex);
    broadcastPlayerState();
  }, []);

  const togglePlay = useCallback(() => {
    const audio = getGlobalAudio();

    const resumeSong = globalCurrentSong;
    if (!audio.src && resumeSong) {
      const resumeIndex = globalCurrentIndex >= 0 ? globalCurrentIndex : 0;
      void playSongInternal(resumeSong, resumeIndex, false);
      return;
    }

    if (isPlaying) {
      audio.pause();
      if (sleepInhibited) {
        sleepInhibited = false;
        uninhibitSleep();
      }
    } else {
      audio
        .play()
        .then(() => {
          if (!sleepInhibited) {
            sleepInhibited = true;
            inhibitSleep();
          }
        })
        .catch((e) => {
          toaster.toast({
            title: "播放失败",
            body: e.message,
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

    if (skipTimeoutId) {
      clearTimeout(skipTimeoutId);
      skipTimeoutId = null;
    }

    if (sleepInhibited) {
      sleepInhibited = false;
      uninhibitSleep();
    }

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
    saveQueueState(globalCurrentProviderId, [], -1);
    broadcastPlayerState();
  }, []);

  const resetAllState = useCallback(() => {
    frontendSaveEnabled = false;
    stop();
    globalPlayMode = "order";
    globalVolume = 1;
    shuffleHistory = [];
    shuffleCursor = -1;
    shufflePool = [];
    originalSleepSettings = null;
    frontendSettings = {};
    frontendSettingsLoaded = false;
    frontendSettingsPromise = null;
    sleepInhibited = false;

    const audio = getGlobalAudio();
    audio.volume = globalVolume;

    setPlayModeState(globalPlayMode);
    setVolumeState(globalVolume);
    setSettingsRestored(false);
    setHasLegacyData(false);
  }, [stop]);

  const enableSettingsSave = useCallback((enabled: boolean) => {
    frontendSaveEnabled = enabled;
  }, []);

  const playAtIndex = useCallback(
    async (index: number) => {
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
      saveQueueState(globalCurrentProviderId, globalPlaylist, globalCurrentIndex);
      const song = globalPlaylist[index];
      await playSongInternal(song, index, true);
      prefetchSongAssets(globalPlaylist[index + 1] || song);
      broadcastPlayerState();
    },
    [playSongInternal]
  );

  const setOnNeedMoreSongs = useCallback((callback: (() => Promise<SongInfo[]>) | null) => {
    onNeedMoreSongsCallback = callback;
  }, []);
  
  // 清空当前队列（但不重置设置）
  const clearCurrentQueue = useCallback(() => {
    stop();
  }, [stop]);

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
    volume,
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
    setVolume,
    enableSettingsSave,
    resetAllState,
    clearCurrentQueue,
    settingsRestored,
    hasLegacyData: false, // Legacy migration removed for now to simplify
    migrateLegacySettings: async () => false, // No-op
    currentProviderId,
  };
}

export function setPreferredQuality(quality: PreferredQuality) {
  updateFrontendSettingsCache({ preferredQuality: quality }, true);
}


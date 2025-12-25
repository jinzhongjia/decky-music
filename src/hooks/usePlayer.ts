/**
 * 播放器状态管理 Hook
 * 使用全局 Audio 单例，确保关闭面板后音乐继续播放
 * 支持播放列表和自动播放下一首
 * 支持播放历史记录
 * 支持播放时禁止系统休眠
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { toaster } from "@decky/api";
import { getSongUrl, getSongLyric } from "../api";
import type { SongInfo } from "../types";
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
}

// 全局休眠状态
let sleepInhibited = false;

// 播放历史存储
const PLAY_HISTORY_KEY = "qqmusic_play_history";
const MAX_HISTORY = 100;

// 加载播放历史
function loadPlayHistory(): SongInfo[] {
  try {
    // eslint-disable-next-line no-undef
    const data = localStorage.getItem(PLAY_HISTORY_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// 保存播放历史
function savePlayHistory(history: SongInfo[]) {
  try {
    // eslint-disable-next-line no-undef
    localStorage.setItem(PLAY_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch {
    // ignore
  }
}

// 添加到播放历史
function addToPlayHistory(song: SongInfo) {
  const history = loadPlayHistory();
  // 移除已存在的相同歌曲，然后添加到开头
  const filtered = history.filter(s => s.mid !== song.mid);
  const newHistory = [song, ...filtered].slice(0, MAX_HISTORY);
  savePlayHistory(newHistory);
  return newHistory;
}

// 全局状态 - 在模块级别创建，不会因组件卸载而销毁
let globalAudio: HTMLAudioElement | null = null;
let globalCurrentSong: SongInfo | null = null;
let globalLyric: ParsedLyric | null = null;
let globalPlaylist: SongInfo[] = [];
let globalCurrentIndex: number = -1;

// 播放下一首的回调（用于在 ended 事件中调用）
let onPlayNextCallback: (() => void) | null = null;

// 播放列表结束时获取更多歌曲的回调
let onNeedMoreSongsCallback: (() => Promise<SongInfo[]>) | null = null;

// 自动跳过的 timeout ID，用于取消
let skipTimeoutId: ReturnType<typeof setTimeout> | null = null;

// 获取或创建全局音频实例
function getGlobalAudio(): HTMLAudioElement {
  if (!globalAudio) {
    globalAudio = new Audio();
    globalAudio.preload = "auto";
    
    // 设置全局的 ended 事件处理
    globalAudio.addEventListener('ended', () => {
      if (onPlayNextCallback) {
        onPlayNextCallback();
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
  onPlayNextCallback = null;
  onNeedMoreSongsCallback = null;
  
  if (skipTimeoutId) {
    clearTimeout(skipTimeoutId);
    skipTimeoutId = null;
  }
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
  playlist: SongInfo[];
  currentIndex: number;
  playHistory: SongInfo[];
  
  // 方法
  playSong: (song: SongInfo) => Promise<void>;
  playPlaylist: (songs: SongInfo[], startIndex?: number) => Promise<void>;
  togglePlay: () => void;
  seek: (time: number) => void;
  stop: () => void;
  playNext: () => void;
  playPrev: () => void;
  setOnNeedMoreSongs: (callback: (() => Promise<SongInfo[]>) | null) => void;
  refreshPlayHistory: () => void;
  clearPlayHistory: () => void;
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
  const [playHistory, setPlayHistory] = useState<SongInfo[]>(loadPlayHistory);
  
  // 用于避免重复调用
  const isPlayingRef = useRef(false);

  // 内部播放歌曲方法
  const playSongInternal = useCallback(async (song: SongInfo, index: number = -1, autoSkipOnError: boolean = true): Promise<boolean> => {
    const audio = getGlobalAudio();
    
    // 取消之前的自动跳过 timeout
    if (skipTimeoutId) {
      clearTimeout(skipTimeoutId);
      skipTimeoutId = null;
    }
    
    setLoading(true);
    setError("");
    setCurrentSong(song);
    setCurrentTime(0);
    setDuration(song.duration);
    setLyric("");
    
    // 更新全局状态
    globalCurrentSong = song;
    globalLyric = null;
    setLyric(null);
    if (index >= 0) {
      globalCurrentIndex = index;
      setCurrentIndex(index);
    }
    
    try {
      // 获取播放链接
      const urlResult = await getSongUrl(song.mid);
      
      if (!urlResult.success || !urlResult.url) {
        const errorMsg = urlResult.error || "该歌曲暂时无法播放";
        setError(errorMsg);
        setLoading(false);
        
        // 显示友好提示
        toaster.toast({
          title: `⚠️ ${song.name}`,
          body: errorMsg,
        });
        
        // 如果是列表播放模式，自动跳到下一首
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
      
      audio.src = urlResult.url;
      audio.load();
      
      try {
        await audio.play();
        setIsPlaying(true);
        isPlayingRef.current = true;
        
        // 禁用休眠
        if (!sleepInhibited) {
          sleepInhibited = true;
          inhibitSleep();
        }
        
        // 添加到播放历史
        const newHistory = addToPlayHistory(song);
        setPlayHistory(newHistory);
        setLoading(false);
      } catch (e) {
        const errorMsg = (e as Error).message;
        setError(errorMsg);
        setLoading(false);
        
        toaster.toast({
          title: "播放失败",
          body: errorMsg
        });
        
        // 自动跳到下一首
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
      
      // 异步获取歌词 (优先获取 QRC 逐字格式)
      getSongLyric(song.mid, true)
        .then(lyricResult => {
          if (lyricResult.success && lyricResult.lyric) {
            const parsed = parseLyric(lyricResult.lyric, lyricResult.trans);
            setLyric(parsed);
            globalLyric = parsed;
          }
        })
        .catch(() => {
          // 歌词获取失败不影响播放
        });
      
      return true;
    } catch (e) {
      const errorMsg = (e as Error).message;
      setError(errorMsg);
      setLoading(false);
      
      toaster.toast({
        title: "播放出错",
        body: errorMsg
      });
      
      return false;
    }
  }, []);

  // 播放下一首
  const playNext = useCallback(async () => {
    if (globalPlaylist.length === 0) return;
    
    let nextIndex = globalCurrentIndex + 1;
    
    // 如果已经是最后一首，尝试获取更多歌曲
    if (nextIndex >= globalPlaylist.length) {
      if (onNeedMoreSongsCallback) {
        try {
          const moreSongs = await onNeedMoreSongsCallback();
          if (moreSongs && moreSongs.length > 0) {
            // 替换为新的歌曲列表
            globalPlaylist = moreSongs;
            globalCurrentIndex = -1;
            setPlaylist(moreSongs);
            nextIndex = 0;
          } else {
            nextIndex = 0; // 没有更多歌曲，循环播放
          }
        } catch (e) {
          console.error("获取更多歌曲失败:", e);
          nextIndex = 0; // 出错时循环播放
        }
      } else {
        nextIndex = 0; // 没有回调，循环播放
      }
    }
    
    const nextSong = globalPlaylist[nextIndex];
    if (nextSong) {
      // 播放下一首时，如果失败也自动跳过
      playSongInternal(nextSong, nextIndex, true);
    }
  }, [playSongInternal]);

  // 播放上一首
  const playPrev = useCallback(() => {
    if (globalPlaylist.length === 0) return;
    
    let prevIndex = globalCurrentIndex - 1;
    if (prevIndex < 0) {
      prevIndex = globalPlaylist.length - 1; // 循环播放
    }
    
    const prevSong = globalPlaylist[prevIndex];
    if (prevSong) {
      playSongInternal(prevSong, prevIndex, true);
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
    // 设置为单曲播放列表
    globalPlaylist = [song];
    globalCurrentIndex = 0;
    setPlaylist([song]);
    setCurrentIndex(0);
    
    await playSongInternal(song, 0);
  }, [playSongInternal]);

  // 播放整个播放列表
  const playPlaylist = useCallback(async (songs: SongInfo[], startIndex: number = 0) => {
    if (songs.length === 0) return;
    
    globalPlaylist = songs;
    globalCurrentIndex = startIndex;
    setPlaylist(songs);
    setCurrentIndex(startIndex);
    
    const song = songs[startIndex];
    if (song) {
      await playSongInternal(song, startIndex);
    }
  }, [playSongInternal]);

  const togglePlay = useCallback(() => {
    const audio = getGlobalAudio();
    
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
  }, [isPlaying]);

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
    globalLyric = "";
    globalPlaylist = [];
    globalCurrentIndex = -1;
    onNeedMoreSongsCallback = null;
    
    setCurrentSong(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setError("");
    setLyric("");
    setPlaylist([]);
    setCurrentIndex(-1);
  }, []);

  // 设置获取更多歌曲的回调
  const setOnNeedMoreSongs = useCallback((callback: (() => Promise<SongInfo[]>) | null) => {
    onNeedMoreSongsCallback = callback;
  }, []);

  // 刷新播放历史（从存储重新加载）
  const refreshPlayHistory = useCallback(() => {
    setPlayHistory(loadPlayHistory());
  }, []);

  // 清空播放历史
  const clearPlayHistory = useCallback(() => {
    savePlayHistory([]);
    setPlayHistory([]);
  }, []);

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
    playHistory,
    playSong,
    playPlaylist,
    togglePlay,
    seek,
    stop,
    playNext,
    playPrev,
    setOnNeedMoreSongs,
    refreshPlayHistory,
    clearPlayHistory,
  };
}

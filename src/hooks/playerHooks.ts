/**
 * 播放器 Hooks 辅助模块
 * 负责处理播放器的副作用和初始化逻辑
 */

import { useEffect } from "react";
import { getProviderInfo } from "../api";
import {
  globalPlaylist,
  globalCurrentIndex,
  globalCurrentProviderId,
  loadQueueStateFromSettings,
  setPlaylist as setQueuePlaylist,
  setCurrentIndex as setQueueCurrentIndex,
  setProviderId as setQueueProviderId,
} from "./useSongQueue";
import {
  ensureFrontendSettingsLoaded,
  getFrontendSettingsCache,
  loadPlayMode,
  loadVolume,
  updateFrontendSettingsCache,
} from "./playerSettings";
import { getGlobalAudio, getGlobalVolume, setGlobalVolume } from "./playerAudio";
import { fetchLyricWithCache } from "./playerLyric";
import {
  setGlobalCurrentSong,
  getGlobalCurrentSong,
  setGlobalLyric,
  getGlobalLyric,
  getGlobalPlayMode,
  setGlobalPlayMode,
  subscribePlayerState,
  broadcastPlayerState,
} from "./playerState";
import { getOnPlayNextCallback } from "./playerNavigation";
import type { SongInfo, PlayMode } from "../types";
import type { ParsedLyric } from "../utils/lyricParser";

/**
 * 创建同步全局状态的函数
 */
export function createSyncFromGlobals(
  setCurrentSong: (song: SongInfo | null) => void,
  setLyric: (lyric: ParsedLyric | null) => void,
  setPlaylist: (playlist: SongInfo[]) => void,
  setCurrentIndex: (index: number) => void,
  setPlayModeState: (mode: PlayMode) => void,
  setVolumeState: (volume: number) => void,
  setIsPlaying: (playing: boolean) => void,
  setCurrentTime: (time: number) => void,
  setDuration: (duration: number) => void,
  setCurrentProviderId: (id: string) => void
): () => void {
  return () => {
    const audio = getGlobalAudio();
    setCurrentSong(getGlobalCurrentSong());
    setLyric(getGlobalLyric());
    setPlaylist([...globalPlaylist]);
    setCurrentIndex(globalCurrentIndex);
    setPlayModeState(getGlobalPlayMode());
    setVolumeState(getGlobalVolume());
    setIsPlaying(!audio.paused);
    setCurrentTime(audio.currentTime);
    setDuration(audio.duration || getGlobalCurrentSong()?.duration || 0);
    setCurrentProviderId(globalCurrentProviderId);
  };
}

/**
 * 订阅全局状态变化的 Hook
 */
export function usePlayerStateSync(
  syncFromGlobals: () => void
): void {
  useEffect(() => {
    const unsubscribe = subscribePlayerState(syncFromGlobals);
    return unsubscribe;
  }, [syncFromGlobals]);
}

/**
 * 初始化播放器设置的 Hook
 */
export function usePlayerInitialization(
  settingsRestored: boolean,
  setSettingsRestored: (restored: boolean) => void,
  setCurrentProviderId: (id: string) => void,
  setPlaylist: (playlist: SongInfo[]) => void,
  setCurrentIndex: (index: number) => void,
  setCurrentSong: (song: SongInfo | null) => void,
  setPlayModeState: (mode: PlayMode) => void,
  setVolumeState: (volume: number) => void
): void {
  useEffect(() => {
    if (settingsRestored) return;

    let cancelled = false;
    void (async () => {
      await ensureFrontendSettingsLoaded();
      if (cancelled) return;

      // 1. 获取当前 Provider
      const providerRes = await getProviderInfo();
      if (!providerRes.success || !providerRes.provider) {
        setSettingsRestored(true);
        return;
      }

      const newProviderId = providerRes.provider.id;
      setQueueProviderId(newProviderId);
      setCurrentProviderId(newProviderId);

      // 2. 检查是否需要恢复队列
      const frontendSettings = getFrontendSettingsCache();
      if (globalPlaylist.length === 0) {
        const stored = loadQueueStateFromSettings(newProviderId, frontendSettings);
        if (stored.playlist.length > 0) {
          setQueuePlaylist(stored.playlist);
          const restoredIndex = stored.currentIndex >= 0 ? stored.currentIndex : 0;
          setQueueCurrentIndex(restoredIndex);
          const restoredSong = globalPlaylist[restoredIndex] || null;
          setGlobalCurrentSong(restoredSong);

          setPlaylist([...globalPlaylist]);
          setCurrentIndex(restoredIndex);
          setCurrentSong(restoredSong);
        }
      }

      // 3. 恢复通用设置
      const restoredPlayMode = loadPlayMode();
      setGlobalPlayMode(restoredPlayMode);
      setPlayModeState(restoredPlayMode);

      const restoredVolume = loadVolume();
      setGlobalVolume(restoredVolume);
      const audio = getGlobalAudio();
      audio.volume = restoredVolume;
      setVolumeState(restoredVolume);

      setSettingsRestored(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [settingsRestored, setSettingsRestored, setCurrentProviderId, setPlaylist, setCurrentIndex, setCurrentSong, setPlayModeState, setVolumeState]);
}

/**
 * 自动获取歌词的 Hook
 */
export function useAutoFetchLyric(
  settingsRestored: boolean,
  currentSong: SongInfo | null,
  lyric: ParsedLyric | null,
  setLyric: (lyric: ParsedLyric | null) => void
): void {
  useEffect(() => {
    if (!settingsRestored) return;
    if (!currentSong) return;
    if (lyric) return;
    void fetchLyricWithCache(currentSong.mid, currentSong.name, currentSong.singer, (parsed) => {
      setGlobalLyric(parsed);
      setLyric(parsed);
      broadcastPlayerState();
    });
  }, [settingsRestored, currentSong, lyric, setLyric]);
}

/**
 * 音频 ended 事件处理的 Hook
 */
export function useAudioEndedHandler(): void {
  useEffect(() => {
    const audio = getGlobalAudio();
    const handleEnded = () => {
      const shouldAutoContinue =
        getGlobalPlayMode() === "single" ||
        getGlobalPlayMode() === "shuffle" ||
        globalPlaylist.length > 1 ||
        Boolean(getOnPlayNextCallback());

      const callback = getOnPlayNextCallback();
      if (callback && shouldAutoContinue) {
        void callback();
      }
    };

    audio.addEventListener("ended", handleEnded);
    return () => {
      audio.removeEventListener("ended", handleEnded);
    };
  }, []);
}

/**
 * 定时更新播放时间的 Hook
 */
export function usePlaybackTimeSync(
  setIsPlaying: (playing: boolean) => void,
  setCurrentTime: (time: number) => void,
  setDuration: (duration: number) => void
): void {
  useEffect(() => {
    const interval = setInterval(() => {
      const audio = getGlobalAudio();
      if (!audio.paused) {
        setCurrentTime(audio.currentTime);
        setDuration(audio.duration || 0);
        setIsPlaying(true);
      } else {
        setIsPlaying(false);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [setIsPlaying, setCurrentTime, setDuration]);
}

/**
 * 恢复指定 provider 的队列状态
 */
export async function restoreQueueForProvider(providerId: string): Promise<void> {
  await ensureFrontendSettingsLoaded();
  const frontendSettings = getFrontendSettingsCache();
  const stored = loadQueueStateFromSettings(providerId, frontendSettings);
  
  if (stored.playlist.length > 0) {
    setQueuePlaylist(stored.playlist);
    const restoredIndex = stored.currentIndex >= 0 ? stored.currentIndex : 0;
    setQueueCurrentIndex(restoredIndex);
    const restoredSong = stored.playlist[restoredIndex] || null;
    setGlobalCurrentSong(restoredSong);
  } else {
    // 如果没有存储的队列，清空当前队列
    setQueuePlaylist([]);
    setQueueCurrentIndex(-1);
    setGlobalCurrentSong(null);
  }
  
  // 广播状态变化，通知所有订阅者（包括 usePlayer hook）
  broadcastPlayerState();
}


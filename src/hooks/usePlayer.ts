/**
 * 播放器状态管理 Hook
 * 使用全局 Audio 单例，确保关闭面板后音乐继续播放
 * 支持播放列表和自动播放下一首
 * 支持播放历史记录
 */

import { useState, useCallback } from "react";
import type { PlayMode, SongInfo } from "../types";
import type { ParsedLyric } from "../utils/lyricParser";
import {
  globalPlaylist,
  globalCurrentIndex,
  globalCurrentProviderId,
  resetQueueState,
} from "./useSongQueue";
import {
  setPreferredQuality,
  savePlayMode,
  saveVolume,
  enableSettingsSave,
} from "./playerSettings";
import { resetAllShuffleState } from "./playerShuffle";
import { getAudioCurrentTime, getGlobalVolume, setGlobalVolume, cleanupAudio } from "./playerAudio";
import {
  getGlobalCurrentSong,
  getGlobalLyric,
  setGlobalPlayMode,
  getGlobalPlayMode,
  broadcastPlayerState,
  resetGlobalPlayerState,
} from "./playerState";
import { playSongInternal, clearSkipTimeout } from "./playerPlayback";
import {
  setOnPlayNextCallback,
  setOnNeedMoreSongsCallback,
  getOnPlayNextCallback,
} from "./playerNavigation";
import { createPlayerMethods } from "./playerMethods";
import {
  createSyncFromGlobals,
  usePlayerStateSync,
  usePlayerInitialization,
  useAutoFetchLyric,
  useAudioEndedHandler,
  usePlaybackTimeSync,
} from "./playerHooks";

// ==================== 全局清理函数 ====================

/**
 * 全局清理函数 - 用于插件卸载时调用
 */
export function cleanupPlayer(): void {
  cleanupAudio();
  resetGlobalPlayerState();
  resetQueueState();
  resetAllShuffleState();
  clearSkipTimeout();
  setOnPlayNextCallback(null);
  setOnNeedMoreSongsCallback(null);
}

// ==================== 导出函数 ====================

/**
 * 获取当前音频播放时间（秒）
 */
export { getAudioCurrentTime };

/**
 * 设置首选音质
 */
export { setPreferredQuality };

// ==================== Hook 接口定义 ====================

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
  playMode: PlayMode;
  volume: number;
  settingsRestored: boolean;
  currentProviderId: string;

  // 方法
  playSong: (song: SongInfo) => Promise<void>;
  playPlaylist: (songs: SongInfo[], startIndex?: number) => Promise<void>;
  addToQueue: (songs: SongInfo[]) => Promise<void>;
  removeFromQueue: (index: number) => void;
  playAtIndex: (index: number) => Promise<void>;
  togglePlay: () => void;
  seek: (time: number) => void;
  stop: () => void;
  playNext: () => void;
  playPrev: () => void;
  setOnNeedMoreSongs: (callback: (() => Promise<SongInfo[]>) | null) => void;
  cyclePlayMode: () => void;
  setPlayMode: (mode: PlayMode) => void;
  setVolume: (volume: number, options?: { commit?: boolean }) => void;
  enableSettingsSave: (enabled: boolean) => void;
  resetAllState: () => void;
  clearCurrentQueue: () => void;
}

// ==================== Hook 实现 ====================

export function usePlayer(): UsePlayerReturn {
  // 从全局状态初始化
  const [currentSong, setCurrentSong] = useState<SongInfo | null>(getGlobalCurrentSong());
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lyric, setLyric] = useState<ParsedLyric | null>(getGlobalLyric());
  const [playlist, setPlaylist] = useState<SongInfo[]>(globalPlaylist);
  const [currentIndex, setCurrentIndex] = useState(globalCurrentIndex);
  const [playMode, setPlayModeState] = useState<PlayMode>(getGlobalPlayMode());
  const [volume, setVolumeState] = useState(getGlobalVolume());
  const [settingsRestored, setSettingsRestored] = useState(false);
  const [currentProviderId, setCurrentProviderId] = useState(globalCurrentProviderId);

  // 监听全局状态变化
  const syncFromGlobals = useCallback(
    createSyncFromGlobals(
      setCurrentSong,
      setLyric,
      setPlaylist,
      setCurrentIndex,
      setPlayModeState,
      setVolumeState,
      setIsPlaying,
      setCurrentTime,
      setDuration,
      setCurrentProviderId
    ),
    []
  );

  usePlayerStateSync(syncFromGlobals);
  usePlayerInitialization(
    settingsRestored,
    setSettingsRestored,
    setCurrentProviderId,
    setPlaylist,
    setCurrentIndex,
    setCurrentSong,
    setPlayModeState,
    setVolumeState
  );
  useAutoFetchLyric(settingsRestored, currentSong, lyric, setLyric);
  useAudioEndedHandler();
  usePlaybackTimeSync(setIsPlaying, setCurrentTime, setDuration);

  // 创建播放内部函数（带状态更新）
  const playSongInternalWithState = useCallback(
    async (song: SongInfo, index: number = -1, autoSkipOnError: boolean = true) => {
      const callback = getOnPlayNextCallback();
      return playSongInternal(
        song,
        index,
        autoSkipOnError,
        callback || undefined,
        setLoading,
        setError,
        setCurrentSong,
        setCurrentTime,
        setDuration,
        setIsPlaying,
        setLyric
      );
    },
    []
  );

  // 创建播放方法
  const {
    playNext,
    playPrev,
    playAtIndex,
    playSong,
    playPlaylist,
    addToQueue,
    removeFromQueue,
    togglePlay,
    seek,
    stop,
    clearQueue,
    resetAllState,
  } = createPlayerMethods({
    playSongInternalWithState,
    isPlaying,
    setPlaylist,
    setCurrentIndex,
    setCurrentTime,
    setCurrentSong,
    setIsPlaying,
    setDuration,
    setError,
    setLyric,
    setPlayModeState,
    setVolumeState,
    setSettingsRestored,
    enableSettingsSave,
  });

  const updatePlayMode = useCallback((mode: PlayMode) => {
    setGlobalPlayMode(mode);
    setPlayModeState(mode);
    savePlayMode(mode);
    if (mode === "shuffle") {
      const { syncShuffleAfterPlaylistChange } = require("./playerShuffle");
      syncShuffleAfterPlaylistChange(globalCurrentIndex);
    }
    broadcastPlayerState();
  }, []);

  const cyclePlayMode = useCallback(() => {
    const currentMode = getGlobalPlayMode();
    const nextMode: PlayMode =
      currentMode === "order" ? "single" : currentMode === "single" ? "shuffle" : "order";
    updatePlayMode(nextMode);
  }, [updatePlayMode]);

  const setVolume = useCallback((value: number, options?: { commit?: boolean }) => {
    const clamped = Math.min(1, Math.max(0, value));
    setGlobalVolume(clamped);
    setVolumeState(clamped);

    if (options?.commit) {
      saveVolume(clamped);
      broadcastPlayerState();
    }
  }, []);

  const setOnNeedMoreSongs = useCallback((callback: (() => Promise<SongInfo[]>) | null) => {
    setOnNeedMoreSongsCallback(callback);
  }, []);

  const clearCurrentQueue = useCallback(() => {
    stop();
    clearQueue();
  }, [stop, clearQueue]);

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
    currentProviderId,
  };
}

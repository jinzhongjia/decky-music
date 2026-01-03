/**
 * 播放器方法创建模块
 * 负责创建播放器的所有操作方法
 */

import { useCallback, useEffect } from "react";
import { broadcastPlayerState } from "./playerState";
import {
  createPlayNext,
  createPlayPrev,
  createPlayAtIndex,
  setOnPlayNextCallback,
  setOnNeedMoreSongsCallback,
} from "./playerNavigation";
import {
  createPlaySong,
  createPlayPlaylist,
  createAddToQueue,
  createRemoveFromQueue,
} from "./playerQueue";
import {
  createTogglePlay,
  createSeek,
  createStop,
  createClearQueue,
  createResetAllState,
} from "./playerControls";
import type { SongInfo, PlayMode } from "../types";
import type { ParsedLyric } from "../utils/lyricParser";

/**
 * 创建播放器方法的参数接口
 */
export interface CreatePlayerMethodsParams {
  playSongInternalWithState: (
    song: SongInfo,
    index?: number,
    autoSkipOnError?: boolean
  ) => Promise<boolean>;
  isPlaying: boolean;
  setPlaylist: (playlist: SongInfo[]) => void;
  setCurrentIndex: (index: number) => void;
  setCurrentTime: (time: number) => void;
  setCurrentSong: (song: SongInfo | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setDuration: (duration: number) => void;
  setError: (error: string) => void;
  setLyric: (lyric: ParsedLyric | null) => void;
  setPlayModeState: (mode: PlayMode) => void;
  setVolumeState: (volume: number) => void;
  setSettingsRestored: (restored: boolean) => void;
  enableSettingsSave: (enabled: boolean) => void;
}

/**
 * 创建所有播放器方法
 */
export function createPlayerMethods(params: CreatePlayerMethodsParams) {
  const {
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
  } = params;

  const playNext = useCallback(() => {
    const fn = createPlayNext(playSongInternalWithState, setPlaylist);
    return fn();
  }, [playSongInternalWithState, setPlaylist]);

  const playPrev = useCallback(() => {
    const fn = createPlayPrev(playSongInternalWithState);
    return fn();
  }, [playSongInternalWithState]);

  const playAtIndex = useCallback(
    async (index: number) => {
      const fn = createPlayAtIndex(playSongInternalWithState);
      await fn(index);
      setCurrentIndex(index);
      broadcastPlayerState();
    },
    [playSongInternalWithState, setCurrentIndex]
  );

  const playSong = useCallback(
    async (song: SongInfo) => {
      const fn = createPlaySong(playSongInternalWithState, setPlaylist, setCurrentIndex);
      await fn(song);
      broadcastPlayerState();
    },
    [playSongInternalWithState, setPlaylist, setCurrentIndex]
  );

  const playPlaylist = useCallback(
    async (songs: SongInfo[], startIndex: number = 0) => {
      const fn = createPlayPlaylist(playSongInternalWithState, setPlaylist, setCurrentIndex);
      await fn(songs, startIndex);
      broadcastPlayerState();
    },
    [playSongInternalWithState, setPlaylist, setCurrentIndex]
  );

  const addToQueue = useCallback(
    async (songs: SongInfo[]) => {
      const fn = createAddToQueue(playSongInternalWithState, setPlaylist, setCurrentIndex);
      await fn(songs);
      broadcastPlayerState();
    },
    [playSongInternalWithState, setPlaylist, setCurrentIndex]
  );

  const removeFromQueue = useCallback(
    (index: number) => {
      const fn = createRemoveFromQueue(setPlaylist);
      fn(index);
      broadcastPlayerState();
    },
    [setPlaylist]
  );

  const togglePlay = useCallback(() => {
    const fn = createTogglePlay(isPlaying, playSongInternalWithState);
    return fn();
  }, [isPlaying, playSongInternalWithState]);

  const seek = useCallback(
    (time: number) => {
      const fn = createSeek(setCurrentTime);
      return fn(time);
    },
    [setCurrentTime]
  );

  const stop = useCallback(() => {
    const fn = createStop(
      setCurrentSong,
      setIsPlaying,
      setCurrentTime,
      setDuration,
      setError,
      setLyric
    );
    return fn();
  }, [setCurrentSong, setIsPlaying, setCurrentTime, setDuration, setError, setLyric]);

  const clearQueue = useCallback(() => {
    const fn = createClearQueue(setPlaylist, setCurrentIndex);
    return fn();
  }, [setPlaylist, setCurrentIndex]);

  const resetAllState = useCallback(() => {
    const fn = createResetAllState(
      stop,
      clearQueue,
      setPlayModeState,
      setVolumeState,
      setSettingsRestored,
      enableSettingsSave
    );
    return fn();
  }, [stop, clearQueue, setPlayModeState, setVolumeState, setSettingsRestored, enableSettingsSave]);

  // 设置播放下一首回调
  useEffect(() => {
    setOnPlayNextCallback(playNext);
    return () => {
      setOnPlayNextCallback(null);
    };
  }, [playNext]);

  return {
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
  };
}


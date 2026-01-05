import { useState, useCallback } from "react";
import type { PlayMode, SongInfo } from "../../types";
import type { ParsedLyric } from "../../utils/lyricParser";
import { getPlayerState } from "./store";
import { getGlobalVolume, setGlobalVolume, cleanupAudio } from "./audio";
import { enableSettingsSave, savePlayMode, saveVolume, setPreferredQuality } from "./persistence";
import { resetAllShuffleState, syncShuffleAfterPlaylistChange } from "./shuffle";
import { playSongInternal, clearSkipTimeout, createTogglePlay, createSeek, createStop, createClearQueue, createResetAllState, setOnNeedMoreSongsCallback } from "./playback";
import {
  broadcastPlayerState,
  setOnPlayNextCallback,
  getOnPlayNextCallback,
  setPlayMode as setGlobalPlayMode,
  getPlayMode as getGlobalPlayMode,
  resetQueueState,
  resetGlobalPlayerState,
  createPlayNext,
  createPlayPrev,
  createPlayAtIndex,
  createPlaySong,
  createPlayPlaylist,
  createAddToQueue,
  createRemoveFromQueue,
} from "./queue";
import {
  useSyncFromGlobals,
  useSettingsRestoration,
  useLyricFetch,
  useAudioTimeSync,
  usePlayNextHandler,
  createSyncFromGlobals,
} from "./effects";

export { getAudioCurrentTime } from "./audio";
export { setPreferredQuality };
export { usePlayerStore } from "./store";

export function cleanupPlayer(): void {
  cleanupAudio();
  resetGlobalPlayerState();
  resetQueueState();
  resetAllShuffleState();
  clearSkipTimeout();
  setOnPlayNextCallback(null);
  setOnNeedMoreSongsCallback(null);
}

export interface UsePlayerReturn {
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

export function usePlayer(): UsePlayerReturn {
  const state = getPlayerState();
  const [currentSong, setCurrentSong] = useState<SongInfo | null>(state.currentSong);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lyric, setLyric] = useState<ParsedLyric | null>(state.lyric);
  const [playlist, setPlaylist] = useState<SongInfo[]>(state.playlist);
  const [currentIndex, setCurrentIndex] = useState(state.currentIndex);
  const [playMode, setPlayModeState] = useState<PlayMode>(state.playMode);
  const [volume, setVolumeState] = useState(getGlobalVolume());
  const [settingsRestored, setSettingsRestored] = useState(false);
  const [currentProviderId, setCurrentProviderId] = useState(state.currentProviderId);

  const syncFromGlobals = useCallback(
    createSyncFromGlobals({
      setCurrentSong, setLyric, setPlaylist, setCurrentIndex, setPlayModeState,
      setVolumeState, setIsPlaying, setCurrentTime, setDuration, setCurrentProviderId, setSettingsRestored,
    }),
    []
  );

  useSyncFromGlobals(syncFromGlobals);
  useSettingsRestoration(settingsRestored, {
    setCurrentSong, setPlaylist, setCurrentIndex, setPlayModeState,
    setVolumeState, setCurrentProviderId, setSettingsRestored,
  });
  useLyricFetch(settingsRestored, currentSong, lyric, setLyric);
  useAudioTimeSync(setCurrentTime, setDuration, setIsPlaying);

  const playSongInternalWithState = useCallback(
    async (song: SongInfo, index: number = -1, autoSkipOnError: boolean = true) => {
      const callback = getOnPlayNextCallback();
      return playSongInternal(song, index, autoSkipOnError, callback || undefined, setLoading, setError, setCurrentSong, setCurrentTime, setDuration, setIsPlaying, setLyric);
    },
    []
  );

  const playNext = useCallback(() => {
    const fn = createPlayNext(playSongInternalWithState, setPlaylist);
    return fn();
  }, [playSongInternalWithState]);

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
    [playSongInternalWithState]
  );

  const playSong = useCallback(
    async (song: SongInfo) => {
      const fn = createPlaySong(playSongInternalWithState, setPlaylist, setCurrentIndex);
      await fn(song);
      broadcastPlayerState();
    },
    [playSongInternalWithState]
  );

  const playPlaylist = useCallback(
    async (songs: SongInfo[], startIndex: number = 0) => {
      const fn = createPlayPlaylist(playSongInternalWithState, setPlaylist, setCurrentIndex);
      await fn(songs, startIndex);
      broadcastPlayerState();
    },
    [playSongInternalWithState]
  );

  const addToQueue = useCallback(
    async (songs: SongInfo[]) => {
      const fn = createAddToQueue(playSongInternalWithState, setPlaylist, setCurrentIndex);
      await fn(songs);
      broadcastPlayerState();
    },
    [playSongInternalWithState]
  );

  const removeFromQueue = useCallback(
    (index: number) => {
      const fn = createRemoveFromQueue(setPlaylist);
      fn(index);
      broadcastPlayerState();
    },
    []
  );

  const togglePlay = useCallback(() => createTogglePlay(isPlaying, playSongInternalWithState)(), [isPlaying, playSongInternalWithState]);
  const seek = useCallback((time: number) => createSeek(setCurrentTime)(time), []);

  const stop = useCallback(() => {
    const fn = createStop(setCurrentSong, setIsPlaying, setCurrentTime, setDuration, setError, setLyric);
    return fn();
  }, []);

  const clearQueue = useCallback(() => {
    const fn = createClearQueue(setPlaylist, setCurrentIndex);
    return fn();
  }, []);

  const resetAllState = useCallback(() => {
    const fn = createResetAllState(stop, clearQueue, setPlayModeState, setVolumeState, setSettingsRestored, enableSettingsSave);
    return fn();
  }, [stop, clearQueue]);

  usePlayNextHandler(playNext);

  const updatePlayMode = useCallback((mode: PlayMode) => {
    setGlobalPlayMode(mode);
    setPlayModeState(mode);
    savePlayMode(mode);
    if (mode === "shuffle") {
      const { currentIndex: idx } = getPlayerState();
      syncShuffleAfterPlaylistChange(idx);
    }
    broadcastPlayerState();
  }, []);

  const cyclePlayMode = useCallback(() => {
    const current = getGlobalPlayMode();
    const next: PlayMode = current === "order" ? "single" : current === "single" ? "shuffle" : "order";
    updatePlayMode(next);
  }, [updatePlayMode]);

  const setVolumeHandler = useCallback((value: number, options?: { commit?: boolean }) => {
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
    currentSong, isPlaying, currentTime, duration, loading, error, lyric, playlist, currentIndex, playMode, volume, settingsRestored, currentProviderId,
    playSong, playPlaylist, addToQueue, playAtIndex, togglePlay, seek, stop, playNext, playPrev, removeFromQueue, setOnNeedMoreSongs, cyclePlayMode,
    setPlayMode: updatePlayMode, setVolume: setVolumeHandler, enableSettingsSave, resetAllState, clearCurrentQueue,
  };
}

import { useState, useCallback, useEffect } from "react";
import { getProviderInfo } from "../../api";
import type { PlayMode, SongInfo } from "../../types";
import type { ParsedLyric } from "../../utils/lyricParser";
import { usePlayerStore, getPlayerState } from "./store";
import { getGlobalAudio, getAudioCurrentTime, getGlobalVolume, setGlobalVolume, cleanupAudio, setGlobalEndedHandler } from "./audio";
import { ensureFrontendSettingsLoaded, getFrontendSettingsCache, loadPlayMode, loadVolume, savePlayMode, saveVolume, enableSettingsSave, setPreferredQuality } from "./persistence";
import { fetchLyricWithCache } from "./lyrics";
import { resetAllShuffleState, syncShuffleAfterPlaylistChange } from "./shuffle";
import { playSongInternal, clearSkipTimeout, createTogglePlay, createSeek, createStop, createClearQueue, createResetAllState, setOnNeedMoreSongsCallback } from "./playback";
import {
  broadcastPlayerState,
  subscribePlayerState,
  setOnPlayNextCallback,
  getOnPlayNextCallback,
  loadQueueStateFromSettings,
  setPlaylist as setQueuePlaylist,
  setCurrentIndex as setQueueCurrentIndex,
  setProviderId as setQueueProviderId,
  setCurrentSong as setGlobalCurrentSong,
  setLyric as setGlobalLyric,
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

export { getAudioCurrentTime, setPreferredQuality, usePlayerStore };

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

  const syncFromGlobals = useCallback(() => {
    const audio = getGlobalAudio();
    const s = getPlayerState();
    setCurrentSong(s.currentSong);
    setLyric(s.lyric);
    setPlaylist([...s.playlist]);
    setCurrentIndex(s.currentIndex);
    setPlayModeState(s.playMode);
    setVolumeState(getGlobalVolume());
    setIsPlaying(!audio.paused);
    setCurrentTime(audio.currentTime);
    setDuration(audio.duration || s.currentSong?.duration || 0);
    setCurrentProviderId(s.currentProviderId);
  }, []);

  useEffect(() => subscribePlayerState(syncFromGlobals), [syncFromGlobals]);

  useEffect(() => {
    if (settingsRestored) return;
    let cancelled = false;

    void (async () => {
      await ensureFrontendSettingsLoaded();
      if (cancelled) return;

      const providerRes = await getProviderInfo();
      if (!providerRes.success || !providerRes.provider) {
        setSettingsRestored(true);
        return;
      }

      const newProviderId = providerRes.provider.id;
      setQueueProviderId(newProviderId);
      setCurrentProviderId(newProviderId);

      const frontendSettings = getFrontendSettingsCache();
      const { playlist: storePlaylist } = getPlayerState();
      if (storePlaylist.length === 0) {
        const stored = loadQueueStateFromSettings(newProviderId, frontendSettings);
        if (stored.playlist.length > 0) {
          setQueuePlaylist(stored.playlist);
          const restoredIndex = stored.currentIndex >= 0 ? stored.currentIndex : 0;
          setQueueCurrentIndex(restoredIndex);
          const restoredSong = stored.playlist[restoredIndex] || null;
          setGlobalCurrentSong(restoredSong);
          setPlaylist([...stored.playlist]);
          setCurrentIndex(restoredIndex);
          setCurrentSong(restoredSong);
        }
      }

      const restoredPlayMode = loadPlayMode();
      setGlobalPlayMode(restoredPlayMode);
      setPlayModeState(restoredPlayMode);

      const restoredVolume = loadVolume();
      setGlobalVolume(restoredVolume);
      getGlobalAudio().volume = restoredVolume;
      setVolumeState(restoredVolume);

      setSettingsRestored(true);
    })();

    return () => { cancelled = true; };
  }, [settingsRestored]);

  useEffect(() => {
    if (!settingsRestored || !currentSong || lyric) return;
    void fetchLyricWithCache(currentSong.mid, currentSong.name, currentSong.singer, (parsed) => {
      setGlobalLyric(parsed);
      setLyric(parsed);
      broadcastPlayerState();
    });
  }, [settingsRestored, currentSong, lyric]);

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
  }, []);

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

  useEffect(() => {
    setOnPlayNextCallback(playNext);
    const endedHandler = () => {
      const pm = getGlobalPlayMode();
      const callback = getOnPlayNextCallback();
      const { playlist: pl } = getPlayerState();
      const shouldAutoContinue = pm === "single" || pm === "shuffle" || pl.length > 1;
      if (callback && shouldAutoContinue) void callback();
    };
    setGlobalEndedHandler(endedHandler);
  }, [playNext]);

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

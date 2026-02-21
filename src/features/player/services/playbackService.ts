/**
 * 播放控制服务 - 管理播放、暂停、切歌等操作
 */

import { toaster } from "@decky/api";
import { getSongUrl } from "../../../api";
import type { SongInfo, PlayMode, PreferredQuality } from "../../../types";
import { usePlayerStore, getPlayerState } from "../../../stores";
import {
  getGlobalAudio,
  setGlobalVolume as setAudioVolume,
  setGlobalEndedHandler,
  setGlobalErrorHandler,
} from "./audioService";
import {
  savePlayModeToBackend,
  saveVolumeToBackend,
  saveProviderQueueToBackend,
  loadPreferredQualityFromBackend,
} from "./persistenceService";
import { fetchLyricWithCache } from "./lyricService";
import {
  resetAllShuffleState,
  syncShuffleAfterPlaylistChange,
  handleShuffleRemove,
  getShuffleNextIndex,
  getShufflePrevIndex,
  handleShuffleJumpTo,
} from "./shuffleService";

let skipTimeoutId: ReturnType<typeof setTimeout> | null = null;
let loadTimeoutId: ReturnType<typeof setTimeout> | null = null;
let onNeedMoreSongsCallback: (() => Promise<SongInfo[]>) | null = null;
let onPlayNextCallback: (() => void) | null = null;
let preferredQuality: PreferredQuality = "auto";
let isTrackChanging = false;
let currentRequestId = 0;

const AUDIO_LOAD_TIMEOUT = 15000;

export function isTrackChangeInProgress(): boolean {
  return isTrackChanging;
}

export function getPreferredQuality(): PreferredQuality {
  return preferredQuality;
}

export async function initializePreferredQuality(): Promise<void> {
  preferredQuality = await loadPreferredQualityFromBackend();
}

function clearSkipTimeout(): void {
  if (skipTimeoutId) {
    clearTimeout(skipTimeoutId);
    skipTimeoutId = null;
  }
}

function setSkipTimeout(callback: () => void): void {
  clearSkipTimeout();
  skipTimeoutId = setTimeout(() => {
    skipTimeoutId = null;
    callback();
  }, 2000);
}

function clearLoadTimeout(): void {
  if (loadTimeoutId) {
    clearTimeout(loadTimeoutId);
    loadTimeoutId = null;
  }
}

function setLoadTimeout(callback: () => void): void {
  clearLoadTimeout();
  loadTimeoutId = setTimeout(() => {
    loadTimeoutId = null;
    callback();
  }, AUDIO_LOAD_TIMEOUT);
}

async function saveQueueState(providerId: string): Promise<void> {
  if (!providerId) return;
  const { playlist, userQueue, currentIndex } = getPlayerState();
  const currentMid = playlist[currentIndex]?.mid;
  await saveProviderQueueToBackend(providerId, playlist, userQueue, currentIndex, currentMid);
}

async function playSongInternal(
  song: SongInfo,
  index: number = -1,
  autoSkipOnError: boolean = true
): Promise<boolean> {
  if (isTrackChanging) return false;
  isTrackChanging = true;
  const requestId = ++currentRequestId;

  const audio = getGlobalAudio();
  const store = usePlayerStore.getState();

  clearSkipTimeout();
  clearLoadTimeout();

  const wasSameSong = store.currentSong?.mid === song.mid;

  store.setLoading(true);
  store.setError("");
  store.setCurrentSong(song);
  store.setCurrentTime(0);
  store.setDuration(song.duration || 0);

  if (!wasSameSong) {
    store.setLyric(null);
  }

  if (index >= 0) {
    store.setCurrentIndex(index);
  }

  const { playlist, userQueue, currentIndex, currentProviderId } = getPlayerState();
  if (currentProviderId) {
    const currentMid = playlist[currentIndex]?.mid;
    void saveProviderQueueToBackend(currentProviderId, playlist, userQueue, currentIndex, currentMid);
  }

  setGlobalErrorHandler((errorMsg: string, shouldAutoSkip: boolean) => {
    if (requestId !== currentRequestId) return;
    store.setError(errorMsg);
    store.setLoading(false);
    toaster.toast({ title: `${song.name}`, body: errorMsg });

    if (shouldAutoSkip && autoSkipOnError && playlist.length > 1 && onPlayNextCallback) {
      setSkipTimeout(onPlayNextCallback);
    }
  });

  try {
    const urlResult = await getSongUrl(song.mid, getPreferredQuality(), song.name, song.singer);

    if (requestId !== currentRequestId) {
      return false;
    }

    if (!urlResult.success || !urlResult.url) {
      const errorMsg = urlResult.error || "该歌曲暂时无法播放";
      store.setError(errorMsg);
      store.setLoading(false);
      toaster.toast({ title: `${song.name}`, body: errorMsg });

      if (autoSkipOnError && playlist.length > 1 && onPlayNextCallback) {
        setSkipTimeout(onPlayNextCallback);
      }
      isTrackChanging = false;
      return false;
    }

    if (urlResult.fallback_provider) {
      toaster.toast({ title: "备用音源", body: `已从 ${urlResult.fallback_provider} 获取` });
    }

    audio.src = urlResult.url;
    audio.load();

    setLoadTimeout(() => {
      if (requestId !== currentRequestId) return;
      store.setError("音频加载超时");
      store.setLoading(false);
      isTrackChanging = false;
      toaster.toast({
        title: `${song.name}`,
        body: "音频加载超时，可能是网络问题\n请手动切换下一首或重试",
      });
    });

    try {
      await audio.play();
      if (requestId !== currentRequestId) return false;
      clearLoadTimeout();
      store.setIsPlaying(true);
      store.setLoading(false);
    } catch (e) {
      if (requestId !== currentRequestId) return false;
      clearLoadTimeout();
      const errorMsg = (e as Error).message;
      store.setError(errorMsg);
      store.setLoading(false);
      toaster.toast({ title: "播放失败", body: errorMsg });

      if (autoSkipOnError && playlist.length > 1 && onPlayNextCallback) {
        setSkipTimeout(onPlayNextCallback);
      }
      isTrackChanging = false;
      return false;
    }

    if (!wasSameSong) {
      void fetchLyricWithCache(song.mid, song.name, song.singer, (parsed) => {
        if (requestId === currentRequestId) {
          store.setLyric(parsed);
        }
      });
    }

    isTrackChanging = false;
    return true;
  } catch (e) {
    if (requestId !== currentRequestId) return false;
    const errorMsg = (e as Error).message;
    store.setError(errorMsg);
    store.setLoading(false);
    toaster.toast({
      title: "播放出错",
      body: `${errorMsg}\n这可能是网络或服务问题，请检查后重试`,
    });
    isTrackChanging = false;
    return false;
  }
}

export function setOnNeedMoreSongs(callback: (() => Promise<SongInfo[]>) | null): void {
  onNeedMoreSongsCallback = callback;
}

export function getOnNeedMoreSongs(): (() => Promise<SongInfo[]>) | null {
  return onNeedMoreSongsCallback;
}

export async function playSong(song: SongInfo): Promise<void> {
  if (isTrackChanging) return;

  const store = usePlayerStore.getState();
  const { currentProviderId } = getPlayerState();

  store.setPlaylist([song]);
  store.setUserQueue([]);
  store.setCurrentIndex(0);
  syncShuffleAfterPlaylistChange(0);
  void saveQueueState(currentProviderId);
  await playSongInternal(song, 0, false);
}

export async function playPlaylist(songs: SongInfo[], startIndex: number = 0): Promise<void> {
  if (songs.length === 0 || isTrackChanging) return;

  const store = usePlayerStore.getState();
  const { currentProviderId } = getPlayerState();

  // 始终替换整个队列（Spotify 行为）
  const clampedIndex = Math.min(Math.max(startIndex, 0), songs.length - 1);
  store.setPlaylist(songs);
  store.setUserQueue([]);
  store.setCurrentIndex(clampedIndex);
  syncShuffleAfterPlaylistChange(clampedIndex);
  void saveQueueState(currentProviderId);
  await playSongInternal(songs[clampedIndex], clampedIndex, false);
}

export async function addToQueue(songs: SongInfo[]): Promise<void> {
  if (songs.length === 0) return;

  const store = usePlayerStore.getState();
  const { playlist, userQueue, currentSong, currentProviderId } = getPlayerState();

  const existingMids = new Set([
    ...playlist.map((s) => s.mid),
    ...userQueue.map((s) => s.mid)
  ]);
  const songsToAdd = songs.filter((s) => !existingMids.has(s.mid));
  if (songsToAdd.length === 0) return;

  if (!currentSong || playlist.length === 0) {
    store.setPlaylist(songsToAdd);
    store.setUserQueue([]);
    store.setCurrentIndex(0);
    syncShuffleAfterPlaylistChange(0);
    void saveQueueState(currentProviderId);
    await playSongInternal(songsToAdd[0], 0, false);
    return;
  }

  const newUserQueue = [...userQueue, ...songsToAdd];
  store.setUserQueue(newUserQueue);
  void saveQueueState(currentProviderId);
}

export function removeFromQueue(index: number): void {
  const store = usePlayerStore.getState();
  const { playlist, userQueue, currentIndex, playMode, currentProviderId } = getPlayerState();

  if (index <= currentIndex || index < 0) return;

  if (index <= currentIndex + userQueue.length) {
    const uqIndex = index - currentIndex - 1;
    const newQueue = [...userQueue];
    newQueue.splice(uqIndex, 1);
    store.setUserQueue(newQueue);
  } else {
    const plIndex = index - userQueue.length;
    if (plIndex >= playlist.length) return;

    const newPlaylist = [...playlist];
    newPlaylist.splice(plIndex, 1);

    if (playMode === "shuffle") {
      handleShuffleRemove(plIndex);
      syncShuffleAfterPlaylistChange(currentIndex);
    }
    store.setPlaylist(newPlaylist);
  }

  void saveQueueState(currentProviderId);
}

export async function playAtIndex(index: number): Promise<void> {
  if (isTrackChanging) return;

  const store = usePlayerStore.getState();
  const { playlist, userQueue, playMode, currentProviderId, currentIndex } = getPlayerState();
  if (index < 0) return;

  const audio = getGlobalAudio();
  audio.pause();

  if (index <= currentIndex) {
    if (playMode === "shuffle") handleShuffleJumpTo(index);
    store.setCurrentIndex(index);
    await playSongInternal(playlist[index], index, true);
  } else if (index <= currentIndex + userQueue.length) {
    const uqIndex = index - currentIndex - 1;
    const itemsToMove = userQueue.slice(0, uqIndex + 1);
    const newQueue = userQueue.slice(uqIndex + 1);

    const newPlaylist = [...playlist];
    newPlaylist.splice(currentIndex + 1, 0, ...itemsToMove);

    store.setPlaylist(newPlaylist);
    store.setUserQueue(newQueue);

    const targetIndex = currentIndex + itemsToMove.length;
    store.setCurrentIndex(targetIndex);

    if (playMode === "shuffle") syncShuffleAfterPlaylistChange(targetIndex);
    await playSongInternal(newPlaylist[targetIndex], targetIndex, true);
  } else {
    const plIndex = index - userQueue.length;
    if (plIndex >= playlist.length) return;

    if (playMode === "shuffle") handleShuffleJumpTo(plIndex);
    store.setCurrentIndex(plIndex);
    await playSongInternal(playlist[plIndex], plIndex, true);
  }

  void saveQueueState(currentProviderId);
}

export function togglePlay(): void {
  const audio = getGlobalAudio();
  const store = usePlayerStore.getState();
  const { currentSong, currentIndex, isPlaying } = getPlayerState();

  const hasValidSrc = audio.src && audio.src !== "" && audio.readyState !== HTMLMediaElement.HAVE_NOTHING;
  if (hasValidSrc) {
    if (isPlaying) {
      audio.pause();
      store.setIsPlaying(false);
    } else {
      audio.play()
        .then(() => store.setIsPlaying(true))
        .catch((e) => toaster.toast({ title: "播放失败", body: e.message }));
    }
  } else if (currentSong) {
    const resumeIndex = currentIndex >= 0 ? currentIndex : 0;
    void playSongInternal(currentSong, resumeIndex, false);
  } else {
    toaster.toast({ title: "无法播放", body: "没有可用的音频源或当前歌曲。" });
  }
}

export function seek(time: number): void {
  const audio = getGlobalAudio();
  const store = usePlayerStore.getState();
  if (audio.duration) {
    const clampedTime = Math.max(0, Math.min(time, audio.duration));
    audio.currentTime = clampedTime;
    store.setCurrentTime(clampedTime);
  }
}

export function stop(): void {
  const audio = getGlobalAudio();
  const store = usePlayerStore.getState();

  audio.pause();
  audio.src = "";
  clearSkipTimeout();
  clearLoadTimeout();
  onNeedMoreSongsCallback = null;

  store.setCurrentSong(null);
  store.setLyric(null);
  store.setIsPlaying(false);
  store.setCurrentTime(0);
  store.setDuration(0);
  store.setError("");
  store.setLoading(false);
}

export async function playNext(): Promise<void> {
  if (isTrackChanging) return;

  const { playlist, userQueue, currentIndex, playMode, currentProviderId } = getPlayerState();
  if (playlist.length === 0) return;

  const audio = getGlobalAudio();
  audio.pause();

  const store = usePlayerStore.getState();

  if (userQueue.length > 0) {
    const nextSong = userQueue[0];
    const newQueue = userQueue.slice(1);

    const newPlaylist = [...playlist];
    newPlaylist.splice(currentIndex + 1, 0, nextSong);

    store.setPlaylist(newPlaylist);
    store.setUserQueue(newQueue);

    const targetIndex = currentIndex + 1;
    if (playMode === "shuffle") {
      syncShuffleAfterPlaylistChange(targetIndex);
    }

    await playSongInternal(nextSong, targetIndex, true);
    void saveQueueState(currentProviderId);
    return;
  }

  let targetIndex: number | null = null;

  if (playMode === "single") {
    targetIndex = currentIndex;
  } else if (playMode === "shuffle") {
    targetIndex = getShuffleNextIndex();
  } else {
    const nextIndex = currentIndex + 1;
    targetIndex = nextIndex < playlist.length ? nextIndex : null;
  }

  if (targetIndex === null || targetIndex < 0 || targetIndex >= playlist.length) {
    if (onNeedMoreSongsCallback) {
      try {
        const prevLength = playlist.length;
        const newSongs = await onNeedMoreSongsCallback();
        if (newSongs.length > 0) {
          const newPlaylist = [...playlist, ...newSongs];
          store.setPlaylist(newPlaylist);

          if (playMode === "shuffle") {
            syncShuffleAfterPlaylistChange(currentIndex);
          }
          void saveQueueState(currentProviderId);

          const { playlist: updatedPlaylist } = getPlayerState();
          if (updatedPlaylist.length > prevLength) {
            return playNext();
          }
        }
      } catch {
        // ignore
      }
    }
    return;
  }

  const nextSong = playlist[targetIndex];
  if (playMode === "shuffle") {
    syncShuffleAfterPlaylistChange(targetIndex);
  }
  if (nextSong) {
    await playSongInternal(nextSong, targetIndex, true);
    void saveQueueState(currentProviderId);
  }
}

export function playPrev(): void {
  if (isTrackChanging) return;

  const { playlist, currentIndex, playMode, currentProviderId } = getPlayerState();
  if (playlist.length === 0) return;

  const audio = getGlobalAudio();
  audio.pause();

  let targetIndex: number | null = null;

  if (playMode === "single") {
    targetIndex = currentIndex;
  } else if (playMode === "shuffle") {
    targetIndex = getShufflePrevIndex();
  } else {
    const prevIndex = currentIndex - 1;
    targetIndex = prevIndex >= 0 ? prevIndex : null;
  }

  if (targetIndex === null || targetIndex < 0 || targetIndex >= playlist.length) return;

  if (playMode === "shuffle") {
    syncShuffleAfterPlaylistChange(targetIndex);
  }

  const prevSong = playlist[targetIndex];
  if (prevSong) {
    void playSongInternal(prevSong, targetIndex, true);
    void saveQueueState(currentProviderId);
  }
}

export function clearQueue(): void {
  const store = usePlayerStore.getState();
  const { currentProviderId } = getPlayerState();

  store.setPlaylist([]);
  store.setUserQueue([]);
  store.setCurrentIndex(-1);

  if (currentProviderId) {
    void saveProviderQueueToBackend(currentProviderId, [], [], -1);
  }
}

export function clearCurrentQueue(): void {
  stop();
  clearQueue();
}

export function setPlayMode(mode: PlayMode): void {
  const store = usePlayerStore.getState();
  store.setPlayMode(mode);
  void savePlayModeToBackend(mode);
  if (mode === "shuffle") {
    const { currentIndex } = getPlayerState();
    syncShuffleAfterPlaylistChange(currentIndex);
  }
}

export function cyclePlayMode(): void {
  const { playMode } = getPlayerState();
  const next: PlayMode = playMode === "order" ? "single" : playMode === "single" ? "shuffle" : "order";
  setPlayMode(next);
}

export function setVolume(value: number, options?: { commit?: boolean }): void {
  const clamped = Math.min(1, Math.max(0, value));
  setAudioVolume(clamped);
  if (options?.commit) {
    void saveVolumeToBackend(clamped);
  }
}

export function resetAllState(): void {
  const store = usePlayerStore.getState();

  stop();
  clearQueue();

  store.setPlayMode("order");
  setAudioVolume(1);
  resetAllShuffleState();

  store.setSettingsRestored(false);
}

export function initPlayNextHandler(): void {
  onPlayNextCallback = playNext;
  setGlobalEndedHandler(() => {
    const { playMode, playlist } = getPlayerState();
    const shouldAutoContinue = playMode === "single" || playMode === "shuffle" || playlist.length > 1;
    if (onPlayNextCallback && shouldAutoContinue) {
      void onPlayNextCallback();
    }
  });
}

export { playSongInternal, clearSkipTimeout };

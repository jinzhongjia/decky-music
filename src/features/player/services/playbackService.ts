/**
 * 播放控制服务 - 管理播放、暂停、切歌等操作
 */

import { toaster } from "@decky/api";
import { getSongUrl } from "../../../api";
import type { SongInfo, PlayMode } from "../../../types";
import { usePlayerStore, getPlayerState } from "../../../stores";
import { getGlobalAudio, setGlobalVolume as setAudioVolume, setGlobalEndedHandler } from "./audioService";
import {
  getPreferredQuality,
  getFrontendSettingsCache,
  updateFrontendSettingsCache,
  savePlayMode,
  saveVolume,
  resetSettingsCache,
  enableSettingsSave as setSettingsSaveEnabled,
} from "./persistenceService";
import { fetchLyricWithCache } from "./lyricService";
import {
  resetAllShuffleState,
  syncShuffleAfterPlaylistChange,
  handleShuffleAdd,
  handleShuffleRemove,
  getShuffleNextIndex,
  getShufflePrevIndex,
  handleShuffleJumpTo,
} from "./shuffleService";

let skipTimeoutId: ReturnType<typeof setTimeout> | null = null;
let onNeedMoreSongsCallback: (() => Promise<SongInfo[]>) | null = null;
let onPlayNextCallback: (() => void) | null = null;

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

function saveQueueState(providerId: string): void {
  if (!providerId) return;
  const { playlist, currentIndex } = getPlayerState();
  const frontendSettings = getFrontendSettingsCache();
  updateFrontendSettingsCache({
    providerQueues: {
      ...(frontendSettings.providerQueues || {}),
      [providerId]: { playlist, currentIndex, currentMid: playlist[currentIndex]?.mid },
    },
  });
}

async function playSongInternal(
  song: SongInfo,
  index: number = -1,
  autoSkipOnError: boolean = true
): Promise<boolean> {
  const audio = getGlobalAudio();
  const store = usePlayerStore.getState();

  clearSkipTimeout();

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

  const { playlist, currentIndex, currentProviderId } = getPlayerState();
  const frontendSettings = getFrontendSettingsCache();
  if (currentProviderId) {
    updateFrontendSettingsCache({
      providerQueues: {
        ...(frontendSettings.providerQueues || {}),
        [currentProviderId]: {
          playlist,
          currentIndex,
          currentMid: playlist[currentIndex]?.mid,
        },
      },
    });
  }

  try {
    const urlResult = await getSongUrl(song.mid, getPreferredQuality(), song.name, song.singer);

    if (!urlResult.success || !urlResult.url) {
      const errorMsg = urlResult.error || "该歌曲暂时无法播放";
      store.setError(errorMsg);
      store.setLoading(false);
      toaster.toast({ title: `${song.name}`, body: errorMsg });

      if (autoSkipOnError && playlist.length > 1 && onPlayNextCallback) {
        setSkipTimeout(onPlayNextCallback);
      }
      return false;
    }

    if (urlResult.fallback_provider) {
      toaster.toast({ title: "备用音源", body: `已从 ${urlResult.fallback_provider} 获取` });
    }

    audio.src = urlResult.url;
    audio.load();

    try {
      await audio.play();
      store.setIsPlaying(true);
      store.setLoading(false);
    } catch (e) {
      const errorMsg = (e as Error).message;
      store.setError(errorMsg);
      store.setLoading(false);
      toaster.toast({ title: "播放失败", body: errorMsg });

      if (autoSkipOnError && playlist.length > 1 && onPlayNextCallback) {
        setSkipTimeout(onPlayNextCallback);
      }
      return false;
    }

    if (!wasSameSong) {
      void fetchLyricWithCache(song.mid, song.name, song.singer, (parsed) => {
        store.setLyric(parsed);
      });
    }

    return true;
  } catch (e) {
    const errorMsg = (e as Error).message;
    store.setError(errorMsg);
    store.setLoading(false);
    toaster.toast({ title: "播放出错", body: errorMsg });
    return false;
  }
}

export function setOnNeedMoreSongs(callback: (() => Promise<SongInfo[]>) | null): void {
  onNeedMoreSongsCallback = callback;
}

export function getOnNeedMoreSongs(): (() => Promise<SongInfo[]>) | null {
  return onNeedMoreSongsCallback;
}

export function enableSettingsSave(enabled: boolean): void {
  setSettingsSaveEnabled(enabled);
}

export async function playSong(song: SongInfo): Promise<void> {
  const store = usePlayerStore.getState();
  const { currentSong, currentIndex, currentProviderId } = getPlayerState();

  if (!currentSong || currentIndex < 0) {
    store.setPlaylist([song]);
    store.setCurrentIndex(0);
    syncShuffleAfterPlaylistChange(0);
    saveQueueState(currentProviderId);
    await playSongInternal(song, 0, false);
    return;
  }

  const { playlist } = getPlayerState();
  const filtered = playlist.filter((s, idx) => s.mid !== song.mid || idx === currentIndex);
  const past = filtered.slice(0, currentIndex + 1);
  const future = filtered.slice(currentIndex + 1);
  const newPlaylist = [...past, song, ...future];
  const newIndex = past.length;

  store.setPlaylist(newPlaylist);
  store.setCurrentIndex(newIndex);
  syncShuffleAfterPlaylistChange(newIndex);
  saveQueueState(currentProviderId);
  await playSongInternal(song, newIndex, false);
}

export async function playPlaylist(songs: SongInfo[], startIndex: number = 0): Promise<void> {
  if (songs.length === 0) return;

  const store = usePlayerStore.getState();
  const { currentSong, currentIndex, currentProviderId } = getPlayerState();

  if (!currentSong || currentIndex < 0) {
    store.setPlaylist(songs);
    store.setCurrentIndex(startIndex);
    syncShuffleAfterPlaylistChange(startIndex);
    saveQueueState(currentProviderId);
    await playSongInternal(songs[startIndex], startIndex, false);
    return;
  }

  const { playlist } = getPlayerState();
  const currentMid = playlist[currentIndex].mid;
  const seen = new Set<string>([currentMid]);
  const cleaned = playlist.filter((s, idx) => {
    if (idx === currentIndex) return true;
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
    const targetIdx = cleaned.findIndex((s) => s.mid === targetMid);

    if (targetIdx >= 0) {
      store.setPlaylist(cleaned);
      store.setCurrentIndex(targetIdx);
      syncShuffleAfterPlaylistChange(targetIdx);
      saveQueueState(currentProviderId);
      await playSongInternal(cleaned[targetIdx], targetIdx, false);
    }
    return;
  }

  const past = cleaned.slice(0, currentIndex + 1);
  const future = cleaned.slice(currentIndex + 1);
  const clampedStartIndex = Math.min(Math.max(startIndex, 0), songsToInsert.length - 1);
  const newPlaylist = [...past, ...songsToInsert, ...future];
  const newIndex = past.length + clampedStartIndex;

  store.setPlaylist(newPlaylist);
  store.setCurrentIndex(newIndex);
  syncShuffleAfterPlaylistChange(newIndex);
  saveQueueState(currentProviderId);
  await playSongInternal(newPlaylist[newIndex], newIndex, false);
}

export async function addToQueue(songs: SongInfo[]): Promise<void> {
  if (songs.length === 0) return;

  const store = usePlayerStore.getState();
  const { playlist, currentSong, currentIndex, playMode, currentProviderId } = getPlayerState();

  const existingMids = new Set(playlist.map((s) => s.mid));
  const songsToAdd = songs.filter((s) => !existingMids.has(s.mid));
  if (songsToAdd.length === 0) return;

  const prevLength = playlist.length;
  const newPlaylist = [...playlist, ...songsToAdd];
  store.setPlaylist(newPlaylist);

  if (playMode === "shuffle") {
    const newIndices = songsToAdd.map((_, idx) => prevLength + idx);
    handleShuffleAdd(newIndices);
  }
  saveQueueState(currentProviderId);

  if (!currentSong || currentIndex < 0) {
    store.setCurrentIndex(0);
    syncShuffleAfterPlaylistChange(0);
    saveQueueState(currentProviderId);
    await playSongInternal(newPlaylist[0], 0, false);
  }
}

export function removeFromQueue(index: number): void {
  const store = usePlayerStore.getState();
  const { playlist, currentIndex, playMode, currentProviderId } = getPlayerState();

  if (index <= currentIndex || index < 0 || index >= playlist.length) return;

  const newPlaylist = [...playlist];
  newPlaylist.splice(index, 1);

  if (playMode === "shuffle") {
    handleShuffleRemove(index);
    syncShuffleAfterPlaylistChange(currentIndex);
  }

  store.setPlaylist(newPlaylist);
  saveQueueState(currentProviderId);
}

export async function playAtIndex(index: number): Promise<void> {
  const store = usePlayerStore.getState();
  const { playlist, playMode, currentProviderId } = getPlayerState();
  if (index < 0 || index >= playlist.length) return;

  const audio = getGlobalAudio();
  audio.pause();

  if (playMode === "shuffle") {
    handleShuffleJumpTo(index);
  }

  store.setCurrentIndex(index);
  const song = playlist[index];
  await playSongInternal(song, index, true);
  saveQueueState(currentProviderId);
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
  onNeedMoreSongsCallback = null;

  store.setCurrentSong(null);
  store.setLyric(null);
  store.setIsPlaying(false);
  store.setCurrentTime(0);
  store.setDuration(0);
  store.setError("");
}

export async function playNext(): Promise<void> {
  const { playlist, currentIndex, playMode, currentProviderId } = getPlayerState();
  if (playlist.length === 0) return;

  const audio = getGlobalAudio();
  audio.pause();

  let targetIndex: number | null = null;

  if (playMode === "single") {
    targetIndex = currentIndex;
  } else if (playMode === "shuffle") {
    targetIndex = getShuffleNextIndex();
  } else {
    const nextIndex = currentIndex + 1;
    targetIndex = nextIndex < playlist.length ? nextIndex : null;
  }

  if (targetIndex === null || targetIndex < 0 || targetIndex >= playlist.length) return;

  const nextSong = playlist[targetIndex];
  if (playMode === "shuffle") {
    syncShuffleAfterPlaylistChange(targetIndex);
  }
  if (nextSong) {
    await playSongInternal(nextSong, targetIndex, true);
    saveQueueState(currentProviderId);
  }
}

export function playPrev(): void {
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
    saveQueueState(currentProviderId);
  }
}

export function clearQueue(): void {
  const store = usePlayerStore.getState();
  const { currentProviderId } = getPlayerState();

  store.setPlaylist([]);
  store.setCurrentIndex(-1);

  if (currentProviderId) {
    const frontendSettings = getFrontendSettingsCache();
    updateFrontendSettingsCache({
      providerQueues: {
        ...(frontendSettings.providerQueues || {}),
        [currentProviderId]: { playlist: [], currentIndex: -1 },
      },
    });
  }
}

export function clearCurrentQueue(): void {
  stop();
  clearQueue();
}

export function setPlayMode(mode: PlayMode): void {
  const store = usePlayerStore.getState();
  store.setPlayMode(mode);
  savePlayMode(mode);
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
    saveVolume(clamped);
  }
}

export function resetAllState(): void {
  const store = usePlayerStore.getState();

  setSettingsSaveEnabled(false);
  stop();
  clearQueue();

  store.setPlayMode("order");
  setAudioVolume(1);
  resetAllShuffleState();
  resetSettingsCache();

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

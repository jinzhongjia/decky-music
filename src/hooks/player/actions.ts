import { toaster } from "@decky/api";
import { getSongUrl } from "../../api";
import type { SongInfo, PlayMode } from "../../types";
import { usePlayerStore, getPlayerState } from "./store";
import { getGlobalAudio, setGlobalVolume as setAudioVolume, setGlobalEndedHandler } from "./audio";
import {
  getPreferredQuality,
  getFrontendSettingsCache,
  updateFrontendSettingsCache,
  savePlayMode,
  saveVolume,
  resetSettingsCache,
  enableSettingsSave as setSettingsSaveEnabled,
} from "./persistence";
import { fetchLyricWithCache } from "./lyrics";
import {
  resetAllShuffleState,
  syncShuffleAfterPlaylistChange,
  handleShuffleAdd,
  handleShuffleRemove,
  getShuffleNextIndex,
  getShufflePrevIndex,
  handleShuffleJumpTo,
} from "./shuffle";
import {
  isSpotifyReady,
  playSpotifyTrack,
  pauseSpotify,
  resumeSpotify,
  seekSpotify,
  setSpotifyVolume,
} from "./spotifyState";

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

// 标记当前是否在使用 Spotify 播放
let isUsingSpotifyPlayer = false;

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

  // 检查是否是 Spotify 歌曲
  if (song.provider === "spotify") {
    return await playSpotifySongInternal(song, autoSkipOnError, playlist);
  }

  // 如果之前在用 Spotify，先暂停
  if (isUsingSpotifyPlayer) {
    try {
      await pauseSpotify();
    } catch {
      // 忽略错误
    }
    isUsingSpotifyPlayer = false;
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

/**
 * 使用 Spotify SDK 播放歌曲
 *
 * 注意：Spotify SDK 的初始化由 SpotifySDKProvider 组件自动处理。
 * 这里只需要调用 playSpotifyTrack 即可。
 */
async function playSpotifySongInternal(
  song: SongInfo,
  autoSkipOnError: boolean,
  playlist: SongInfo[]
): Promise<boolean> {
  const store = usePlayerStore.getState();
  const audio = getGlobalAudio();

  // 暂停 HTML Audio
  audio.pause();
  audio.src = "";

  // 检查 Spotify 是否就绪（由 SpotifySDKProvider 管理）
  if (!isSpotifyReady()) {
    const errorMsg = "Spotify 播放器未就绪，请确保你有 Premium 订阅并已登录";
    store.setError(errorMsg);
    store.setLoading(false);
    toaster.toast({ title: "Spotify 错误", body: errorMsg });

    if (autoSkipOnError && playlist.length > 1 && onPlayNextCallback) {
      setSkipTimeout(onPlayNextCallback);
    }
    return false;
  }

  try {
    const success = await playSpotifyTrack(song.mid);
    if (!success) {
      const errorMsg = "播放 Spotify 歌曲失败";
      store.setError(errorMsg);
      store.setLoading(false);
      toaster.toast({ title: song.name, body: errorMsg });

      if (autoSkipOnError && playlist.length > 1 && onPlayNextCallback) {
        setSkipTimeout(onPlayNextCallback);
      }
      return false;
    }

    isUsingSpotifyPlayer = true;
    store.setIsPlaying(true);
    store.setLoading(false);

    // 获取歌词
    void fetchLyricWithCache(song.mid, song.name, song.singer, (parsed) => {
      store.setLyric(parsed);
    });

    return true;
  } catch (e) {
    const errorMsg = (e as Error).message;
    store.setError(errorMsg);
    store.setLoading(false);
    toaster.toast({ title: "Spotify 播放出错", body: errorMsg });
    return false;
  }
}

/**
 * 检查当前是否在使用 Spotify 播放器
 */
export function isCurrentlyUsingSpotify(): boolean {
  return isUsingSpotifyPlayer;
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

  // 如果当前是 Spotify 歌曲
  if (currentSong?.provider === "spotify" && isUsingSpotifyPlayer) {
    if (isPlaying) {
      pauseSpotify()
        .then(() => store.setIsPlaying(false))
        .catch((e) => toaster.toast({ title: "暂停失败", body: (e as Error).message }));
    } else {
      resumeSpotify()
        .then(() => store.setIsPlaying(true))
        .catch((e) => toaster.toast({ title: "播放失败", body: (e as Error).message }));
    }
    return;
  }

  // HTMLMediaElement.HAVE_NOTHING = 0
  const hasValidSrc = audio.src && audio.src !== "" && audio.readyState !== 0;
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
  const store = usePlayerStore.getState();
  const { currentSong, duration } = getPlayerState();

  // 如果当前是 Spotify 歌曲
  if (currentSong?.provider === "spotify" && isUsingSpotifyPlayer) {
    const clampedTime = Math.max(0, Math.min(time, duration));
    seekSpotify(clampedTime * 1000) // Spotify 使用毫秒
      .then(() => store.setCurrentTime(clampedTime))
      .catch((e) => console.error("Spotify seek error:", e));
    return;
  }

  const audio = getGlobalAudio();
  if (audio.duration) {
    const clampedTime = Math.max(0, Math.min(time, audio.duration));
    audio.currentTime = clampedTime;
    store.setCurrentTime(clampedTime);
  }
}

export function stop(): void {
  const audio = getGlobalAudio();
  const store = usePlayerStore.getState();

  // 停止 Spotify 播放器
  if (isUsingSpotifyPlayer) {
    pauseSpotify().catch(() => {});
    isUsingSpotifyPlayer = false;
  }

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

  // 同时设置 Spotify 音量
  if (isUsingSpotifyPlayer) {
    setSpotifyVolume(clamped).catch(() => {});
  }

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

export { playSongInternal };

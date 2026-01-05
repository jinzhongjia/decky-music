import type { SongInfo, FrontendSettings, StoredQueueState, PlayMode } from "../../types";
import type { ParsedLyric } from "../../utils/lyricParser";
import { usePlayerStore, getPlayerState } from "./store";
import { getGlobalAudio } from "./audio";
import { getFrontendSettingsCache, updateFrontendSettingsCache } from "./persistence";
import {
  syncShuffleAfterPlaylistChange,
  getShuffleNextIndex,
  getShufflePrevIndex,
  handleShuffleJumpTo,
  handleShuffleAdd,
  handleShuffleRemove,
} from "./shuffle";
import { playSongInternal } from "./playback";

const playerSubscribers = new Set<() => void>();

function notifyPlayerSubscribers(): void {
  playerSubscribers.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });
}

export function broadcastPlayerState(): void {
  notifyPlayerSubscribers();
}

export function subscribePlayerState(callback: () => void): () => void {
  playerSubscribers.add(callback);
  return () => playerSubscribers.delete(callback);
}

let onPlayNextCallback: (() => void) | null = null;

export function setOnPlayNextCallback(callback: (() => void) | null): void {
  onPlayNextCallback = callback;
}

export function getOnPlayNextCallback(): (() => void) | null {
  return onPlayNextCallback;
}

export function loadQueueStateFromSettings(
  providerId: string,
  frontendSettings: FrontendSettings
): StoredQueueState {
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

export function saveQueueState(providerId: string): void {
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

export function clearQueueState(providerId: string): void {
  if (!providerId) return;
  const frontendSettings = getFrontendSettingsCache();
  updateFrontendSettingsCache({
    providerQueues: {
      ...(frontendSettings.providerQueues || {}),
      [providerId]: { playlist: [], currentIndex: -1 },
    },
  });
}

export function setCurrentSong(song: SongInfo | null): void {
  usePlayerStore.getState().setCurrentSong(song);
}

export function getCurrentSong(): SongInfo | null {
  return getPlayerState().currentSong;
}

export function setLyric(lyric: ParsedLyric | null): void {
  usePlayerStore.getState().setLyric(lyric);
}

export function getLyric(): ParsedLyric | null {
  return getPlayerState().lyric;
}

export function setPlayMode(mode: PlayMode): void {
  usePlayerStore.getState().setPlayMode(mode);
}

export function getPlayMode(): PlayMode {
  return getPlayerState().playMode;
}

export function setPlaylist(playlist: SongInfo[]): void {
  usePlayerStore.getState().setPlaylist(playlist);
}

export function setCurrentIndex(index: number): void {
  usePlayerStore.getState().setCurrentIndex(index);
}

export function setProviderId(providerId: string): void {
  usePlayerStore.getState().setCurrentProviderId(providerId);
}

export function resetQueueState(): void {
  const store = usePlayerStore.getState();
  store.setPlaylist([]);
  store.setCurrentIndex(-1);
  store.setCurrentProviderId("");
}

export function resetGlobalPlayerState(): void {
  const store = usePlayerStore.getState();
  store.reset();
  playerSubscribers.clear();
}

export function createPlayNext(
  playSongInternalFn: typeof playSongInternal,
  _setPlaylistLocal?: (playlist: SongInfo[]) => void
): () => Promise<void> {
  return async () => {
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
      await playSongInternalFn(nextSong, targetIndex, true, onPlayNextCallback || undefined);
      saveQueueState(currentProviderId);
    }
  };
}

export function createPlayPrev(playSongInternalFn: typeof playSongInternal): () => void {
  return () => {
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
      void playSongInternalFn(prevSong, targetIndex, true, onPlayNextCallback || undefined);
      saveQueueState(currentProviderId);
    }
  };
}

export function createPlayAtIndex(playSongInternalFn: typeof playSongInternal): (index: number) => Promise<void> {
  return async (index: number) => {
    const { playlist, playMode, currentProviderId } = getPlayerState();
    if (index < 0 || index >= playlist.length) return;

    const audio = getGlobalAudio();
    audio.pause();

    if (playMode === "shuffle") {
      handleShuffleJumpTo(index);
    }

    setCurrentIndex(index);
    const song = playlist[index];
    await playSongInternalFn(song, index, true, onPlayNextCallback || undefined);
    saveQueueState(currentProviderId);
  };
}

export function createPlaySong(
  playSongInternalFn: typeof playSongInternal,
  setPlaylistLocal: (playlist: SongInfo[]) => void,
  setCurrentIndexLocal: (index: number) => void
): (song: SongInfo) => Promise<void> {
  return async (song: SongInfo) => {
    const store = usePlayerStore.getState();
    const { currentSong, currentIndex, currentProviderId } = getPlayerState();

    if (!currentSong || currentIndex < 0) {
      store.setPlaylist([song]);
      store.setCurrentIndex(0);
      setPlaylistLocal([song]);
      setCurrentIndexLocal(0);
      syncShuffleAfterPlaylistChange(0);
      saveQueueState(currentProviderId);
      await playSongInternalFn(song, 0, false, onPlayNextCallback || undefined);
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
    setPlaylistLocal([...newPlaylist]);
    setCurrentIndexLocal(newIndex);
    syncShuffleAfterPlaylistChange(newIndex);
    saveQueueState(currentProviderId);
    await playSongInternalFn(song, newIndex, false, onPlayNextCallback || undefined);
  };
}

export function createPlayPlaylist(
  playSongInternalFn: typeof playSongInternal,
  setPlaylistLocal: (playlist: SongInfo[]) => void,
  setCurrentIndexLocal: (index: number) => void
): (songs: SongInfo[], startIndex?: number) => Promise<void> {
  return async (songs: SongInfo[], startIndex: number = 0) => {
    if (songs.length === 0) return;

    const store = usePlayerStore.getState();
    const { currentSong, currentIndex, currentProviderId } = getPlayerState();

    if (!currentSong || currentIndex < 0) {
      store.setPlaylist(songs);
      store.setCurrentIndex(startIndex);
      setPlaylistLocal([...songs]);
      setCurrentIndexLocal(startIndex);
      syncShuffleAfterPlaylistChange(startIndex);
      saveQueueState(currentProviderId);
      await playSongInternalFn(songs[startIndex], startIndex, false, onPlayNextCallback || undefined);
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
        setPlaylistLocal([...cleaned]);
        setCurrentIndexLocal(targetIdx);
        syncShuffleAfterPlaylistChange(targetIdx);
        saveQueueState(currentProviderId);
        await playSongInternalFn(cleaned[targetIdx], targetIdx, false, onPlayNextCallback || undefined);
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
    setPlaylistLocal([...newPlaylist]);
    setCurrentIndexLocal(newIndex);
    syncShuffleAfterPlaylistChange(newIndex);
    saveQueueState(currentProviderId);
    await playSongInternalFn(newPlaylist[newIndex], newIndex, false, onPlayNextCallback || undefined);
  };
}

export function createAddToQueue(
  playSongInternalFn: typeof playSongInternal,
  setPlaylistLocal: (playlist: SongInfo[]) => void,
  setCurrentIndexLocal: (index: number) => void
): (songs: SongInfo[]) => Promise<void> {
  return async (songs: SongInfo[]) => {
    if (songs.length === 0) return;

    const store = usePlayerStore.getState();
    const { playlist, currentSong, currentIndex, playMode, currentProviderId } = getPlayerState();

    const existingMids = new Set(playlist.map((s) => s.mid));
    const songsToAdd = songs.filter((s) => !existingMids.has(s.mid));
    if (songsToAdd.length === 0) return;

    const prevLength = playlist.length;
    const newPlaylist = [...playlist, ...songsToAdd];
    store.setPlaylist(newPlaylist);
    setPlaylistLocal(newPlaylist);

    if (playMode === "shuffle") {
      const newIndices = songsToAdd.map((_, idx) => prevLength + idx);
      handleShuffleAdd(newIndices);
    }
    saveQueueState(currentProviderId);

    if (!currentSong || currentIndex < 0) {
      store.setCurrentIndex(0);
      setCurrentIndexLocal(0);
      syncShuffleAfterPlaylistChange(0);
      saveQueueState(currentProviderId);
      await playSongInternalFn(newPlaylist[0], 0, false, onPlayNextCallback || undefined);
    }
  };
}

export function createRemoveFromQueue(setPlaylistLocal: (playlist: SongInfo[]) => void): (index: number) => void {
  return (index: number) => {
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
    setPlaylistLocal(newPlaylist);
    saveQueueState(currentProviderId);
  };
}

export async function restoreQueueForProvider(providerId: string): Promise<void> {
  const { ensureFrontendSettingsLoaded } = await import("./persistence");
  await ensureFrontendSettingsLoaded();
  const frontendSettings = getFrontendSettingsCache();
  const stored = loadQueueStateFromSettings(providerId, frontendSettings);
  const store = usePlayerStore.getState();

  if (stored.playlist.length > 0) {
    store.setPlaylist(stored.playlist);
    const restoredIndex = stored.currentIndex >= 0 ? stored.currentIndex : 0;
    store.setCurrentIndex(restoredIndex);
    const restoredSong = stored.playlist[restoredIndex] || null;
    store.setCurrentSong(restoredSong);
  } else {
    store.setPlaylist([]);
    store.setCurrentIndex(-1);
    store.setCurrentSong(null);
  }

  broadcastPlayerState();
}

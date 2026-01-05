import type { SongInfo } from "../../types";
import { usePlayerStore, getPlayerState } from "./store";
import { syncShuffleAfterPlaylistChange, handleShuffleAdd, handleShuffleRemove } from "./shuffle";
import { playSongInternal } from "./playback";
import { getFrontendSettingsCache } from "./persistence";
import {
  broadcastPlayerState,
  saveQueueState,
  loadQueueStateFromSettings,
} from "./state";
import { getOnPlayNextCallback } from "./navigation";

export {
  broadcastPlayerState,
  subscribePlayerState,
  setCurrentSong,
  getCurrentSong,
  setLyric,
  getLyric,
  setPlayMode,
  getPlayMode,
  setPlaylist,
  setCurrentIndex,
  setProviderId,
  resetQueueState,
  resetGlobalPlayerState,
  loadQueueStateFromSettings,
  saveQueueState,
  clearQueueState,
} from "./state";

export {
  setOnPlayNextCallback,
  getOnPlayNextCallback,
  createPlayNext,
  createPlayPrev,
  createPlayAtIndex,
} from "./navigation";

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
      await playSongInternalFn(song, 0, false, getOnPlayNextCallback() || undefined);
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
    await playSongInternalFn(song, newIndex, false, getOnPlayNextCallback() || undefined);
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
      await playSongInternalFn(songs[startIndex], startIndex, false, getOnPlayNextCallback() || undefined);
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
        await playSongInternalFn(cleaned[targetIdx], targetIdx, false, getOnPlayNextCallback() || undefined);
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
    await playSongInternalFn(newPlaylist[newIndex], newIndex, false, getOnPlayNextCallback() || undefined);
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
      await playSongInternalFn(newPlaylist[0], 0, false, getOnPlayNextCallback() || undefined);
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

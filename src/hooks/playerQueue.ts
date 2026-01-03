/**
 * 播放器队列操作模块
 * 负责处理播放列表的增删改查操作
 */

import {
  globalPlaylist,
  globalCurrentIndex,
  globalCurrentProviderId,
  setPlaylist as setQueuePlaylist,
  setCurrentIndex as setQueueCurrentIndex,
  saveQueueState,
} from "./useSongQueue";
import {
  getGlobalCurrentSong,
  getGlobalPlayMode,
} from "./playerState";
import {
  getFrontendSettingsCache,
  updateFrontendSettingsCache,
} from "./playerSettings";
import {
  syncShuffleAfterPlaylistChange,
  handleShuffleAdd,
  handleShuffleRemove,
} from "./playerShuffle";
import type { SongInfo } from "../types";
import { playSongInternal } from "./playerPlayback";
import { getOnPlayNextCallback } from "./playerNavigation";

/**
 * 创建播放单曲的函数
 */
export function createPlaySong(
  playSongInternalFn: typeof playSongInternal,
  setPlaylist: (playlist: SongInfo[]) => void,
  setCurrentIndex: (index: number) => void
): (song: SongInfo) => Promise<void> {
  return async (song: SongInfo) => {
    if (!getGlobalCurrentSong() || globalCurrentIndex < 0) {
      setQueuePlaylist([song]);
      setQueueCurrentIndex(0);
      setPlaylist([song]);
      setCurrentIndex(0);
      syncShuffleAfterPlaylistChange(0);
      // 立即保存队列状态
      const frontendSettings = getFrontendSettingsCache();
      saveQueueState(
        globalCurrentProviderId,
        globalPlaylist,
        globalCurrentIndex,
        frontendSettings.providerQueues,
        updateFrontendSettingsCache
      );
      const callback = getOnPlayNextCallback();
      await playSongInternalFn(song, 0, false, callback || undefined);
      return;
    }

    const filtered = globalPlaylist.filter(
      (s, idx) => s.mid !== song.mid || idx === globalCurrentIndex
    );

    const past = filtered.slice(0, globalCurrentIndex + 1);
    const future = filtered.slice(globalCurrentIndex + 1);
    const newPlaylist = [...past, song, ...future];
    const newIndex = past.length;
    setQueuePlaylist(newPlaylist);
    setQueueCurrentIndex(newIndex);
    setPlaylist([...globalPlaylist]);
    setCurrentIndex(newIndex);
    syncShuffleAfterPlaylistChange(newIndex);
    const frontendSettings = getFrontendSettingsCache();
    saveQueueState(
      globalCurrentProviderId,
      globalPlaylist,
      globalCurrentIndex,
      frontendSettings.providerQueues,
      updateFrontendSettingsCache
    );
    const callback = getOnPlayNextCallback();
    await playSongInternalFn(song, newIndex, false, callback || undefined);
  };
}

/**
 * 创建播放播放列表的函数
 */
export function createPlayPlaylist(
  playSongInternalFn: typeof playSongInternal,
  setPlaylist: (playlist: SongInfo[]) => void,
  setCurrentIndex: (index: number) => void
): (songs: SongInfo[], startIndex?: number) => Promise<void> {
  return async (songs: SongInfo[], startIndex: number = 0) => {
    if (songs.length === 0) return;

    if (!getGlobalCurrentSong() || globalCurrentIndex < 0) {
      setQueuePlaylist(songs);
      setQueueCurrentIndex(startIndex);
      setPlaylist([...songs]);
      setCurrentIndex(startIndex);
      syncShuffleAfterPlaylistChange(startIndex);
      // 立即保存队列状态
      const frontendSettings = getFrontendSettingsCache();
      saveQueueState(
        globalCurrentProviderId,
        globalPlaylist,
        globalCurrentIndex,
        frontendSettings.providerQueues,
        updateFrontendSettingsCache
      );
      const callback = getOnPlayNextCallback();
      await playSongInternalFn(songs[startIndex], startIndex, false, callback || undefined);
      return;
    }

    const currentMid = globalPlaylist[globalCurrentIndex].mid;
    const seen = new Set<string>([currentMid]);
    const cleaned = globalPlaylist.filter((s, idx) => {
      if (idx === globalCurrentIndex) return true;
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
      const targetIndex = cleaned.findIndex((s) => s.mid === targetMid);

      if (targetIndex < 0) {
        setQueuePlaylist(cleaned);
        setPlaylist([...cleaned]);
        const frontendSettings = getFrontendSettingsCache();
        saveQueueState(
          globalCurrentProviderId,
          globalPlaylist,
          globalCurrentIndex,
          frontendSettings.providerQueues,
          updateFrontendSettingsCache
        );
        return;
      }

      setQueuePlaylist(cleaned);
      setQueueCurrentIndex(targetIndex);
      setPlaylist([...cleaned]);
      setCurrentIndex(targetIndex);
      syncShuffleAfterPlaylistChange(targetIndex);
      const frontendSettings = getFrontendSettingsCache();
      saveQueueState(
        globalCurrentProviderId,
        globalPlaylist,
        globalCurrentIndex,
        frontendSettings.providerQueues,
        updateFrontendSettingsCache
      );
      const callback = getOnPlayNextCallback();
      await playSongInternalFn(globalPlaylist[targetIndex], targetIndex, false, callback || undefined);
      return;
    }

    const past = cleaned.slice(0, globalCurrentIndex + 1);
    const future = cleaned.slice(globalCurrentIndex + 1);
    const clampedStartIndex = Math.min(Math.max(startIndex, 0), songsToInsert.length - 1);
    const newPlaylist = [...past, ...songsToInsert, ...future];
    const newIndex = past.length + clampedStartIndex;
    setQueuePlaylist(newPlaylist);
    setQueueCurrentIndex(newIndex);
    setPlaylist([...globalPlaylist]);
    setCurrentIndex(newIndex);
    syncShuffleAfterPlaylistChange(newIndex);
    const frontendSettings = getFrontendSettingsCache();
    saveQueueState(
      globalCurrentProviderId,
      globalPlaylist,
      globalCurrentIndex,
      frontendSettings.providerQueues,
      updateFrontendSettingsCache
    );
    const callback = getOnPlayNextCallback();
    await playSongInternalFn(globalPlaylist[newIndex], newIndex, false, callback || undefined);
  };
}

/**
 * 创建添加到队列的函数
 */
export function createAddToQueue(
  playSongInternalFn: typeof playSongInternal,
  setPlaylist: (playlist: SongInfo[]) => void,
  setCurrentIndex: (index: number) => void
): (songs: SongInfo[]) => Promise<void> {
  return async (songs: SongInfo[]) => {
    if (songs.length === 0) return;
    const existingMids = new Set(globalPlaylist.map((s) => s.mid));
    const songsToAdd = songs.filter((s) => !existingMids.has(s.mid));
    if (songsToAdd.length === 0) return;

    const prevLength = globalPlaylist.length;
    const newPlaylist = [...globalPlaylist, ...songsToAdd];
    setQueuePlaylist(newPlaylist);
    setPlaylist(newPlaylist);
    if (getGlobalPlayMode() === "shuffle") {
      const newIndices = songsToAdd.map((_, idx) => prevLength + idx);
      handleShuffleAdd(newIndices);
    }
    const frontendSettings = getFrontendSettingsCache();
    saveQueueState(
      globalCurrentProviderId,
      globalPlaylist,
      globalCurrentIndex,
      frontendSettings.providerQueues,
      updateFrontendSettingsCache
    );

    if (!getGlobalCurrentSong() || globalCurrentIndex < 0) {
      setQueueCurrentIndex(0);
      setCurrentIndex(0);
      syncShuffleAfterPlaylistChange(0);
      // 更新索引后再次保存
      const frontendSettings2 = getFrontendSettingsCache();
      saveQueueState(
        globalCurrentProviderId,
        globalPlaylist,
        globalCurrentIndex,
        frontendSettings2.providerQueues,
        updateFrontendSettingsCache
      );
      const callback = getOnPlayNextCallback();
      await playSongInternalFn(newPlaylist[0], 0, false, callback || undefined);
    }
  };
}

/**
 * 创建从队列移除的函数
 */
export function createRemoveFromQueue(
  setPlaylist: (playlist: SongInfo[]) => void
): (index: number) => void {
  return (index: number) => {
    if (index <= globalCurrentIndex) return;
    if (index < 0 || index >= globalPlaylist.length) return;
    globalPlaylist.splice(index, 1);
    if (getGlobalPlayMode() === "shuffle") {
      handleShuffleRemove(index);
      syncShuffleAfterPlaylistChange(globalCurrentIndex);
    }
    setPlaylist([...globalPlaylist]);
    const frontendSettings = getFrontendSettingsCache();
    saveQueueState(
      globalCurrentProviderId,
      globalPlaylist,
      globalCurrentIndex,
      frontendSettings.providerQueues,
      updateFrontendSettingsCache
    );
  };
}


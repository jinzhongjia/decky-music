/**
 * 播放器导航逻辑模块
 * 负责处理播放列表的导航（上一首、下一首、跳转）
 */

import {
  globalPlaylist,
  globalCurrentIndex,
  setCurrentIndex as setQueueCurrentIndex,
} from "./useSongQueue";
import {
  getGlobalPlayMode,
} from "./playerState";
import {
  syncShuffleAfterPlaylistChange,
  getShuffleNextIndex,
  getShufflePrevIndex,
  handleShuffleJumpTo,
} from "./playerShuffle";
import type { SongInfo } from "../types";
import { playSongInternal } from "./playerPlayback";
import { getGlobalAudio } from "./playerAudio";

// 播放下一首的回调（用于在 ended 事件中调用）
let onPlayNextCallback: (() => void) | null = null;

// 播放列表结束时获取更多歌曲的回调
let onNeedMoreSongsCallback: (() => Promise<SongInfo[]>) | null = null;

/**
 * 设置播放下一首的回调
 */
export function setOnPlayNextCallback(callback: (() => void) | null): void {
  onPlayNextCallback = callback;
}

/**
 * 获取播放下一首的回调
 */
export function getOnPlayNextCallback(): (() => void) | null {
  return onPlayNextCallback;
}

/**
 * 设置获取更多歌曲的回调
 */
export function setOnNeedMoreSongsCallback(
  callback: (() => Promise<SongInfo[]>) | null
): void {
  onNeedMoreSongsCallback = callback;
}

/**
 * 获取获取更多歌曲的回调
 */
export function getOnNeedMoreSongsCallback():
  | (() => Promise<SongInfo[]>)
  | null {
  return onNeedMoreSongsCallback;
}

/**
 * 创建播放下一首的函数
 */
export function createPlayNext(
  playSongInternalFn: typeof playSongInternal,
  setPlaylist?: (playlist: SongInfo[]) => void
): () => Promise<void> {
  return async () => {
    if (globalPlaylist.length === 0) return;

    // 立即暂停当前播放，提升响应速度
    const audio = getGlobalAudio();
    audio.pause();

    const resolveOrderNext = async (): Promise<number | null> => {
      let nextIndex = globalCurrentIndex + 1;
      if (nextIndex >= globalPlaylist.length) {
        if (onNeedMoreSongsCallback) {
          try {
            const moreSongs = await onNeedMoreSongsCallback();
            if (moreSongs && moreSongs.length > 0) {
              const insertPos = globalCurrentIndex + 1;
              globalPlaylist.splice(insertPos, 0, ...moreSongs);
              setPlaylist?.([...globalPlaylist]);
              nextIndex = insertPos;
            } else {
              return null;
            }
          } catch {
            return null;
          }
        } else {
          return null;
        }
      }
      return nextIndex;
    };

    let targetIndex: number | null = null;
    const currentMode = getGlobalPlayMode();
    if (currentMode === "single") {
      targetIndex = globalCurrentIndex;
    } else if (currentMode === "shuffle") {
      targetIndex = getShuffleNextIndex();
    } else {
      targetIndex = await resolveOrderNext();
    }

    if (targetIndex === null || targetIndex < 0 || targetIndex >= globalPlaylist.length) {
      return;
    }

    const nextSong = globalPlaylist[targetIndex];
    if (currentMode === "shuffle") {
      syncShuffleAfterPlaylistChange(targetIndex);
    }
    if (nextSong) {
      // playSongInternal 内部已经会调用 saveQueueState，这里不需要重复调用
      await playSongInternalFn(nextSong, targetIndex, true, onPlayNextCallback || undefined);
    }
  };
}

/**
 * 创建播放上一首的函数
 */
export function createPlayPrev(
  playSongInternalFn: typeof playSongInternal
): () => void {
  return () => {
    if (globalPlaylist.length === 0) return;

    // 立即暂停当前播放，提升响应速度
    const audio = getGlobalAudio();
    audio.pause();

    let targetIndex: number | null = null;
    const currentMode = getGlobalPlayMode();
    if (currentMode === "single") {
      targetIndex = globalCurrentIndex;
    } else if (currentMode === "shuffle") {
      targetIndex = getShufflePrevIndex();
    } else {
      const prevIndex = globalCurrentIndex - 1;
      targetIndex = prevIndex >= 0 ? prevIndex : null;
    }

    if (targetIndex === null || targetIndex < 0 || targetIndex >= globalPlaylist.length) {
      return;
    }

    if (currentMode === "shuffle") {
      syncShuffleAfterPlaylistChange(targetIndex);
    }

    const prevSong = globalPlaylist[targetIndex];
    if (prevSong) {
      // playSongInternal 内部已经会调用 saveQueueState，这里不需要重复调用
      void playSongInternalFn(prevSong, targetIndex, true, onPlayNextCallback || undefined);
    }
  };
}

/**
 * 创建按索引播放的函数
 */
export function createPlayAtIndex(
  playSongInternalFn: typeof playSongInternal
): (index: number) => Promise<void> {
  return async (index: number) => {
    if (index < 0 || index >= globalPlaylist.length) return;

    // 立即暂停当前播放，提升响应速度
    const audio = getGlobalAudio();
    audio.pause();

    if (getGlobalPlayMode() === "shuffle") {
      handleShuffleJumpTo(index);
    }
    setQueueCurrentIndex(index);
    // playSongInternal 内部已经会调用 saveQueueState，这里不需要重复调用
    const song = globalPlaylist[index];
    await playSongInternalFn(song, index, true, onPlayNextCallback || undefined);
  };
}


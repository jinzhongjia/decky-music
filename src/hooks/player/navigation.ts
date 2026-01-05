import type { SongInfo } from "../../types";
import { getPlayerState } from "./store";
import { getGlobalAudio } from "./audio";
import { syncShuffleAfterPlaylistChange, getShuffleNextIndex, getShufflePrevIndex, handleShuffleJumpTo } from "./shuffle";
import { playSongInternal } from "./playback";
import { setCurrentIndex, saveQueueState } from "./state";

let onPlayNextCallback: (() => void) | null = null;

export function setOnPlayNextCallback(callback: (() => void) | null): void {
  onPlayNextCallback = callback;
}

export function getOnPlayNextCallback(): (() => void) | null {
  return onPlayNextCallback;
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

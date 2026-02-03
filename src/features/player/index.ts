/**
 * Player 功能模块入口
 */

// Hooks
export { usePlayer, cleanupPlayer, getAudioCurrentTime } from "./hooks/usePlayer";
export type { UsePlayerReturn } from "./hooks/usePlayer";
export { usePlayerEffects } from "./hooks/usePlayerEffects";
export { useAudioTime, useAudioTimeRAF, getAudioTime } from "./hooks/useAudioTime";

// Services (供需要直接访问的模块使用)
export {
  playSong,
  playPlaylist,
  addToQueue,
  removeFromQueue,
  playAtIndex,
  togglePlay,
  seek,
  stop,
  playNext,
  playPrev,
  clearCurrentQueue,
  setPlayMode,
  cyclePlayMode,
  setVolume,
  resetAllState,
  setOnNeedMoreSongs,
  initPlayNextHandler,
  getPreferredQuality,
  initializePreferredQuality,
  isTrackChangeInProgress,
} from "./services/playbackService";

export {
  restoreQueueForProvider,
  saveQueueState,
  clearQueueState,
  broadcastPlayerState,
  subscribePlayerState,
} from "./services/queueService";

export { fetchLyricWithCache } from "./services/lyricService";
export { getGlobalAudio, cleanupAudio, setGlobalVolume } from "./services/audioService";
export { resetAllShuffleState, syncShuffleAfterPlaylistChange } from "./services/shuffleService";

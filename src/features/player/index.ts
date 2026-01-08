/**
 * Player 功能模块入口
 */

// Hooks
export { usePlayer, cleanupPlayer, getAudioCurrentTime, setPreferredQuality } from "./hooks/usePlayer";
export type { UsePlayerReturn } from "./hooks/usePlayer";
export { usePlayerEffects } from "./hooks/usePlayerEffects";

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
  enableSettingsSave,
  initPlayNextHandler,
} from "./services/playbackService";

export {
  restoreQueueForProvider,
  saveQueueState,
  clearQueueState,
  broadcastPlayerState,
  subscribePlayerState,
} from "./services/queueService";

export {
  ensureFrontendSettingsLoaded,
  getFrontendSettingsCache,
  updateFrontendSettingsCache,
  getPreferredQuality,
} from "./services/persistenceService";

export { fetchLyricWithCache } from "./services/lyricService";
export { getGlobalAudio, cleanupAudio, setGlobalVolume } from "./services/audioService";
export { resetAllShuffleState, syncShuffleAfterPlaylistChange } from "./services/shuffleService";

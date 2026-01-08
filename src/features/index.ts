/**
 * Features 统一导出
 */

// Player 功能
export { usePlayer, cleanupPlayer, getAudioCurrentTime, setPreferredQuality } from "./player";
export type { UsePlayerReturn } from "./player";

// Auth 功能
export { useAuth, useAuthStatus, setAuthLoggedIn } from "./auth";
export type { UseAuthReturn } from "./auth";

// Data 功能
export {
  useDataManager,
  loadGuessLike,
  refreshGuessLike,
  fetchGuessLikeRaw,
  loadDailyRecommend,
  loadPlaylists,
  clearDataCache,
  replaceGuessLikeSongs,
} from "./data";
export type { UseDataManagerReturn } from "./data";

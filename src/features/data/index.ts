/**
 * Data 功能模块入口
 */

export { useDataManager } from "./hooks/useDataManager";
export type { UseDataManagerReturn } from "./hooks/useDataManager";

export {
  loadGuessLike,
  refreshGuessLike,
  fetchGuessLikeRaw,
  loadDailyRecommend,
  loadPlaylists,
  clearDataCache,
  replaceGuessLikeSongs,
} from "./services/dataLoaders";

export { preloadSongCovers, preloadPlaylistCovers } from "./services/imagePreloader";

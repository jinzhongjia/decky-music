import { useState, useEffect, useMemo } from "react";
import { cache, addListener, clearDataCache, replaceGuessLikeSongs } from "./cache";
import {
  loadGuessLike,
  refreshGuessLike,
  fetchGuessLikeRaw,
  loadDailyRecommend,
  loadPlaylists,
  preloadData,
} from "./loaders";

export {
  clearDataCache,
  replaceGuessLikeSongs,
  loadGuessLike,
  refreshGuessLike,
  fetchGuessLikeRaw,
  loadDailyRecommend,
  loadPlaylists,
  preloadData,
};

export {
  getGuessLikeSongs,
  getDailySongs,
  getCreatedPlaylists,
  getCollectedPlaylists,
  isGuessLoading,
  isDailyLoading,
  isPlaylistsLoading,
  isGuessLoaded,
  isDailyLoaded,
  isPlaylistsLoaded,
} from "./cache";

export function useDataManager() {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    return addListener(() => setVersion((v) => v + 1));
  }, []);

  return useMemo(
    () => ({
      guessLikeSongs: cache.guessLikeSongs,
      guessLoading: cache.guessLoading,
      guessLoaded: cache.guessLoaded,
      loadGuessLike,
      refreshGuessLike,
      fetchGuessLikeRaw,

      dailySongs: cache.dailySongs,
      dailyLoading: cache.dailyLoading,
      dailyLoaded: cache.dailyLoaded,
      loadDailyRecommend,

      createdPlaylists: cache.createdPlaylists,
      collectedPlaylists: cache.collectedPlaylists,
      playlistsLoading: cache.playlistsLoading,
      playlistsLoaded: cache.playlistsLoaded,
      loadPlaylists,

      preloadData,
      clearDataCache,
      provider: null as { id: string; name: string } | null,
    }),
    [version]
  );
}

/**
 * 数据管理 Hook
 */

import { useMemo } from "react";
import { useDataStore } from "../../../stores";
import {
  loadGuessLike,
  refreshGuessLike,
  fetchGuessLikeRaw,
  loadDailyRecommend,
  loadPlaylists,
  preloadData,
  clearDataCache,
} from "../services/dataLoaders";

export function useDataManager() {
  // 订阅 store 状态变化
  const guessLikeSongs = useDataStore((s) => s.guessLikeSongs);
  const guessLoading = useDataStore((s) => s.guessLoading);
  const guessLoaded = useDataStore((s) => s.guessLoaded);

  const dailySongs = useDataStore((s) => s.dailySongs);
  const dailyLoading = useDataStore((s) => s.dailyLoading);
  const dailyLoaded = useDataStore((s) => s.dailyLoaded);

  const createdPlaylists = useDataStore((s) => s.createdPlaylists);
  const collectedPlaylists = useDataStore((s) => s.collectedPlaylists);
  const playlistsLoading = useDataStore((s) => s.playlistsLoading);
  const playlistsLoaded = useDataStore((s) => s.playlistsLoaded);

  return useMemo(
    () => ({
      // 猜你喜欢
      guessLikeSongs,
      guessLoading,
      guessLoaded,
      loadGuessLike,
      refreshGuessLike,
      fetchGuessLikeRaw,

      // 每日推荐
      dailySongs,
      dailyLoading,
      dailyLoaded,
      loadDailyRecommend,

      // 歌单
      createdPlaylists,
      collectedPlaylists,
      playlistsLoading,
      playlistsLoaded,
      loadPlaylists,

      // 工具
      preloadData,
      clearDataCache,
    }),
    [
      guessLikeSongs,
      guessLoading,
      guessLoaded,
      dailySongs,
      dailyLoading,
      dailyLoaded,
      createdPlaylists,
      collectedPlaylists,
      playlistsLoading,
      playlistsLoaded,
    ]
  );
}

export type UseDataManagerReturn = ReturnType<typeof useDataManager>;

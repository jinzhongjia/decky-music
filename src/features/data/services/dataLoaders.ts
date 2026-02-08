/**
 * 数据加载服务
 */

import { getGuessLike, getDailyRecommend, getUserPlaylists } from "../../../api";
import { useDataStore, getDataState } from "../../../stores";
import type { SongInfo, PlaylistInfo } from "../../../types";
import { preloadSongCovers, preloadPlaylistCovers } from "./imagePreloader";

let guessLikePromise: Promise<SongInfo[]> | null = null;
let dailyRecommendPromise: Promise<SongInfo[]> | null = null;
let playlistsPromise: Promise<{ created: PlaylistInfo[]; collected: PlaylistInfo[] }> | null = null;
let guessLikeRawPromise: Promise<SongInfo[]> | null = null;

export const loadGuessLike = async (forceRefresh = false): Promise<SongInfo[]> => {
  const state = getDataState();

  if (state.guessLoaded && !forceRefresh) {
    return state.guessLikeSongs;
  }

  if (guessLikePromise) {
    return guessLikePromise;
  }

  const store = useDataStore.getState();
  store.setGuessLoading(true);

  guessLikePromise = (async () => {
    try {
      const result = await getGuessLike();
      if (result.success && result.songs.length > 0) {
        store.setGuessLikeSongs(result.songs);
        preloadSongCovers(result.songs);
        return result.songs;
      }
    } catch {
      // ignore
    } finally {
      store.setGuessLoading(false);
      guessLikePromise = null;
    }

    return getDataState().guessLikeSongs;
  })();

  return guessLikePromise;
};

export const refreshGuessLike = async (): Promise<SongInfo[]> => {
  return loadGuessLike(true);
};

export const fetchGuessLikeRaw = async (): Promise<SongInfo[]> => {
  if (guessLikeRawPromise) {
    return guessLikeRawPromise;
  }

  guessLikeRawPromise = (async () => {
    try {
      const result = await getGuessLike();
      if (result.success && result.songs.length > 0) {
        return result.songs;
      }
    } catch {
      // ignore
    } finally {
      guessLikeRawPromise = null;
    }

    return [];
  })();

  return guessLikeRawPromise;
};

export const loadDailyRecommend = async (): Promise<SongInfo[]> => {
  const state = getDataState();

  if (state.dailyLoaded) {
    return state.dailySongs;
  }

  if (dailyRecommendPromise) {
    return dailyRecommendPromise;
  }

  const store = useDataStore.getState();
  store.setDailyLoading(true);

  dailyRecommendPromise = (async () => {
    try {
      const result = await getDailyRecommend();
      if (result.success && result.songs.length > 0) {
        store.setDailySongs(result.songs);
        preloadSongCovers(result.songs);
        return result.songs;
      }
    } catch {
      // ignore
    } finally {
      store.setDailyLoading(false);
      dailyRecommendPromise = null;
    }

    return getDataState().dailySongs;
  })();

  return dailyRecommendPromise;
};

export const loadPlaylists = async (): Promise<{
  created: PlaylistInfo[];
  collected: PlaylistInfo[];
}> => {
  const state = getDataState();

  if (state.playlistsLoaded) {
    return { created: state.createdPlaylists, collected: state.collectedPlaylists };
  }

  if (playlistsPromise) {
    return playlistsPromise;
  }

  const store = useDataStore.getState();
  store.setPlaylistsLoading(true);

  playlistsPromise = (async () => {
    try {
      const result = await getUserPlaylists();
      if (result.success) {
        const created = result.created || [];
        const collected = result.collected || [];
        store.setPlaylists(created, collected);
        preloadPlaylistCovers([...created, ...collected]);
        return { created, collected };
      }
    } catch {
      // ignore
    } finally {
      store.setPlaylistsLoading(false);
      playlistsPromise = null;
    }

    const currentState = getDataState();
    return { created: currentState.createdPlaylists, collected: currentState.collectedPlaylists };
  })();

  return playlistsPromise;
};

export const preloadData = async (): Promise<void> => {
  await Promise.allSettled([
    loadGuessLike(),
    loadDailyRecommend(),
    loadPlaylists(),
  ]);
};

export const clearDataCache = (): void => {
  useDataStore.getState().clearAll();
};

export const replaceGuessLikeSongs = (songs: SongInfo[]): void => {
  useDataStore.getState().setGuessLikeSongs(songs);
};

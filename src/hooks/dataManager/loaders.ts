import { getGuessLike, getDailyRecommend, getUserPlaylists } from "../../api";
import type { SongInfo, PlaylistInfo } from "../../types";
import { cache, notifyListeners } from "./cache";
import { preloadSongCovers, preloadPlaylistCovers } from "./imagePreloader";

let guessLikePromise: Promise<SongInfo[]> | null = null;
let dailyRecommendPromise: Promise<SongInfo[]> | null = null;
let playlistsPromise: Promise<{ created: PlaylistInfo[]; collected: PlaylistInfo[] }> | null = null;
let guessLikeRawPromise: Promise<SongInfo[]> | null = null;

export const loadGuessLike = async (forceRefresh = false): Promise<SongInfo[]> => {
  if (cache.guessLoaded && !forceRefresh) {
    return cache.guessLikeSongs;
  }

  if (guessLikePromise) {
    return guessLikePromise;
  }

  cache.guessLoading = true;
  notifyListeners();

  guessLikePromise = (async () => {
    try {
      const result = await getGuessLike();
      if (result.success && result.songs.length > 0) {
        cache.guessLikeSongs = result.songs;
        cache.guessLoaded = true;
        preloadSongCovers(result.songs);
      }
    } catch {
      // ignore
    } finally {
      cache.guessLoading = false;
      notifyListeners();
      guessLikePromise = null;
    }

    return cache.guessLikeSongs;
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
  if (cache.dailyLoaded) {
    return cache.dailySongs;
  }

  if (dailyRecommendPromise) {
    return dailyRecommendPromise;
  }

  cache.dailyLoading = true;
  notifyListeners();

  dailyRecommendPromise = (async () => {
    try {
      const result = await getDailyRecommend();
      if (result.success && result.songs.length > 0) {
        cache.dailySongs = result.songs;
        cache.dailyLoaded = true;
        preloadSongCovers(result.songs);
      }
    } catch {
      // ignore
    } finally {
      cache.dailyLoading = false;
      notifyListeners();
      dailyRecommendPromise = null;
    }

    return cache.dailySongs;
  })();

  return dailyRecommendPromise;
};

export const loadPlaylists = async (): Promise<{
  created: PlaylistInfo[];
  collected: PlaylistInfo[];
}> => {
  if (cache.playlistsLoaded) {
    return { created: cache.createdPlaylists, collected: cache.collectedPlaylists };
  }

  if (playlistsPromise) {
    return playlistsPromise;
  }

  cache.playlistsLoading = true;
  notifyListeners();

  playlistsPromise = (async () => {
    try {
      const result = await getUserPlaylists();
      if (result.success) {
        cache.createdPlaylists = result.created || [];
        cache.collectedPlaylists = result.collected || [];
        cache.playlistsLoaded = true;
        preloadPlaylistCovers([...cache.createdPlaylists, ...cache.collectedPlaylists]);
      }
    } catch {
      // ignore
    } finally {
      cache.playlistsLoading = false;
      notifyListeners();
      playlistsPromise = null;
    }

    return { created: cache.createdPlaylists, collected: cache.collectedPlaylists };
  })();

  return playlistsPromise;
};

export const preloadData = async () => {};

/**
 * 全局数据管理器
 * 用于预加载和共享数据（猜你喜欢、每日推荐、歌单等）
 * 在插件初始化时预加载，左侧全屏页面和右侧侧边栏共享
 */

import { getGuessLike, getDailyRecommend, getUserPlaylists } from "../api";
import type { SongInfo, PlaylistInfo } from "../types";

// ==================== 数据缓存 ====================

interface DataCache {
  // 猜你喜欢
  guessLikeSongs: SongInfo[];
  guessLoaded: boolean;
  guessLoading: boolean;
  
  // 每日推荐
  dailySongs: SongInfo[];
  dailyLoaded: boolean;
  dailyLoading: boolean;
  
  // 用户歌单
  createdPlaylists: PlaylistInfo[];
  collectedPlaylists: PlaylistInfo[];
  playlistsLoaded: boolean;
  playlistsLoading: boolean;
}

const cache: DataCache = {
  guessLikeSongs: [],
  guessLoaded: false,
  guessLoading: false,
  
  dailySongs: [],
  dailyLoaded: false,
  dailyLoading: false,
  
  createdPlaylists: [],
  collectedPlaylists: [],
  playlistsLoaded: false,
  playlistsLoading: false,
};

// 正在进行的请求（避免并发重复请求）
let guessLikePromise: Promise<SongInfo[]> | null = null;
let dailyRecommendPromise: Promise<SongInfo[]> | null = null;
let playlistsPromise: Promise<{ created: PlaylistInfo[]; collected: PlaylistInfo[] }> | null = null;
let guessLikeRawPromise: Promise<SongInfo[]> | null = null;

// 监听器列表
type Listener = () => void;
const listeners: Set<Listener> = new Set();

// 通知所有监听器
const notifyListeners = () => {
  listeners.forEach(listener => listener());
};

// ==================== 图片预加载 ====================

const MAX_PRELOAD_COVERS = 80;
const PRELOAD_BATCH_SIZE = 5;
const PRELOAD_IDLE_TIMEOUT = 1000;
const preloadedCoverUrls = new Set<string>();

/**
 * 预加载图片
 */
const preloadImage = (url: string): Promise<void> => {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve();
    img.onerror = () => resolve(); // 加载失败也继续
    img.src = url;
  });
};

/**
 * 批量预加载歌曲封面
 */
const schedulePreloadImages = (covers: string[]) => {
  const pending = covers.filter((cover) => cover && !preloadedCoverUrls.has(cover));
  if (pending.length === 0) return;

  const capped = pending.slice(0, MAX_PRELOAD_COVERS);
  capped.forEach((cover) => preloadedCoverUrls.add(cover));

  let index = 0;
  const runBatch = () => {
    const batch = capped.slice(index, index + PRELOAD_BATCH_SIZE);
    if (batch.length === 0) return;
    index += PRELOAD_BATCH_SIZE;
    Promise.all(batch.map(preloadImage)).finally(() => scheduleNext());
  };

  const scheduleNext = () => {
    if (index >= capped.length) return;
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(runBatch, { timeout: PRELOAD_IDLE_TIMEOUT });
    } else {
      setTimeout(runBatch, 0);
    }
  };

  scheduleNext();
};

const preloadSongCovers = (songs: SongInfo[]) => {
  const covers = songs
    .filter(song => song.cover)
    .map(song => song.cover as string);

  schedulePreloadImages(covers);
};

/**
 * 批量预加载歌单封面
 */
const preloadPlaylistCovers = (playlists: PlaylistInfo[]) => {
  const covers = playlists
    .filter(p => p.cover)
    .map(p => p.cover as string);

  schedulePreloadImages(covers);
};

// ==================== 数据加载函数 ====================

/**
 * 加载猜你喜欢
 */
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
        // 预加载封面图片
        preloadSongCovers(result.songs);
      }
    } catch (e) {
      console.error("[DataManager] 加载猜你喜欢失败:", e);
    } finally {
      cache.guessLoading = false;
      notifyListeners();
      guessLikePromise = null;
    }

    return cache.guessLikeSongs;
  })();

  return guessLikePromise;
};

/**
 * 刷新猜你喜欢（换一批）
 */
export const refreshGuessLike = async (): Promise<SongInfo[]> => {
  return loadGuessLike(true);
};

/**
 * 获取猜你喜欢但不更新缓存
 * 用于预取，避免影响首页列表
 */
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
    } catch (e) {
      console.error("[DataManager] 预取猜你喜欢失败:", e);
    } finally {
      guessLikeRawPromise = null;
    }

    return [];
  })();

  return guessLikeRawPromise;
};

/**
 * 加载每日推荐
 */
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
        // 预加载封面图片
        preloadSongCovers(result.songs);
      }
    } catch (e) {
      console.error("[DataManager] 加载每日推荐失败:", e);
    } finally {
      cache.dailyLoading = false;
      notifyListeners();
      dailyRecommendPromise = null;
    }

    return cache.dailySongs;
  })();

  return dailyRecommendPromise;
};

/**
 * 加载用户歌单
 */
export const loadPlaylists = async (): Promise<{ created: PlaylistInfo[], collected: PlaylistInfo[] }> => {
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
        // 预加载歌单封面
        preloadPlaylistCovers([...cache.createdPlaylists, ...cache.collectedPlaylists]);
      }
    } catch (e) {
      console.error("[DataManager] 加载歌单失败:", e);
    } finally {
      cache.playlistsLoading = false;
      notifyListeners();
      playlistsPromise = null;
    }

    return { created: cache.createdPlaylists, collected: cache.collectedPlaylists };
  })();

  return playlistsPromise;
};

// ==================== 预加载 ====================

/**
 * 预加载所有数据（在插件初始化时调用）
 * 已弃用，保留为空函数以兼容
 */
export const preloadData = async () => {};


// ==================== 清理 ====================

/**
 * 清除所有缓存（退出登录时调用）
 */
export const clearDataCache = () => {
  cache.guessLikeSongs = [];
  cache.guessLoaded = false;
  cache.guessLoading = false;
  guessLikePromise = null;
  
  cache.dailySongs = [];
  cache.dailyLoaded = false;
  cache.dailyLoading = false;
  dailyRecommendPromise = null;
  
  cache.createdPlaylists = [];
  cache.collectedPlaylists = [];
  cache.playlistsLoaded = false;
  cache.playlistsLoading = false;
  playlistsPromise = null;
  
  notifyListeners();
};

// ==================== Getter ====================

export const getGuessLikeSongs = () => cache.guessLikeSongs;
export const getDailySongs = () => cache.dailySongs;
export const getCreatedPlaylists = () => cache.createdPlaylists;
export const getCollectedPlaylists = () => cache.collectedPlaylists;

export const isGuessLoading = () => cache.guessLoading;
export const isDailyLoading = () => cache.dailyLoading;
export const isPlaylistsLoading = () => cache.playlistsLoading;

export const isGuessLoaded = () => cache.guessLoaded;
export const isDailyLoaded = () => cache.dailyLoaded;
export const isPlaylistsLoaded = () => cache.playlistsLoaded;

/**
 * 替换当前的猜你喜欢列表并通知订阅者
 */
export const replaceGuessLikeSongs = (songs: SongInfo[]) => {
  cache.guessLikeSongs = songs;
  cache.guessLoaded = true;
  cache.guessLoading = false;
  notifyListeners();
};

// ==================== Hook ====================

import { useState, useEffect } from "react";

/**
 * 使用数据管理器的 Hook
 * 自动订阅数据变化
 */
export function useDataManager() {
  const [, forceUpdate] = useState({});

  useEffect(() => {
    const listener = () => forceUpdate({});
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return {
    // 猜你喜欢
    guessLikeSongs: cache.guessLikeSongs,
    guessLoading: cache.guessLoading,
    guessLoaded: cache.guessLoaded,
    loadGuessLike,
    refreshGuessLike,
    fetchGuessLikeRaw,
    
    // 每日推荐
    dailySongs: cache.dailySongs,
    dailyLoading: cache.dailyLoading,
    dailyLoaded: cache.dailyLoaded,
    loadDailyRecommend,
    
    // 歌单
    createdPlaylists: cache.createdPlaylists,
    collectedPlaylists: cache.collectedPlaylists,
    playlistsLoading: cache.playlistsLoading,
    playlistsLoaded: cache.playlistsLoaded,
    loadPlaylists,
    
    // 其他
    preloadData,
    clearDataCache,
    provider: null as { id: string; name: string } | null, // 占位，需要 useProvider 获取
  };
}

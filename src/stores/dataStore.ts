/**
 * 数据缓存状态管理
 */

import { create } from "zustand";
import type { SongInfo, PlaylistInfo } from "../types";

interface DataState {
  // 猜你喜欢
  guessLikeSongs: SongInfo[];
  guessLoaded: boolean;
  guessLoading: boolean;

  // 每日推荐
  dailySongs: SongInfo[];
  dailyLoaded: boolean;
  dailyLoading: boolean;

  // 歌单
  createdPlaylists: PlaylistInfo[];
  collectedPlaylists: PlaylistInfo[];
  playlistsLoaded: boolean;
  playlistsLoading: boolean;
}

interface DataActions {
  // 猜你喜欢
  setGuessLikeSongs: (songs: SongInfo[]) => void;
  setGuessLoading: (loading: boolean) => void;
  setGuessLoaded: (loaded: boolean) => void;

  // 每日推荐
  setDailySongs: (songs: SongInfo[]) => void;
  setDailyLoading: (loading: boolean) => void;
  setDailyLoaded: (loaded: boolean) => void;

  // 歌单
  setPlaylists: (created: PlaylistInfo[], collected: PlaylistInfo[]) => void;
  setPlaylistsLoading: (loading: boolean) => void;
  setPlaylistsLoaded: (loaded: boolean) => void;

  // 清空所有缓存
  clearAll: () => void;
}

const initialState: DataState = {
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

export const useDataStore = create<DataState & DataActions>((set) => ({
  ...initialState,

  setGuessLikeSongs: (songs) => set({ guessLikeSongs: songs, guessLoaded: true, guessLoading: false }),
  setGuessLoading: (loading) => set({ guessLoading: loading }),
  setGuessLoaded: (loaded) => set({ guessLoaded: loaded }),

  setDailySongs: (songs) => set({ dailySongs: songs, dailyLoaded: true, dailyLoading: false }),
  setDailyLoading: (loading) => set({ dailyLoading: loading }),
  setDailyLoaded: (loaded) => set({ dailyLoaded: loaded }),

  setPlaylists: (created, collected) =>
    set({
      createdPlaylists: created,
      collectedPlaylists: collected,
      playlistsLoaded: true,
      playlistsLoading: false,
    }),
  setPlaylistsLoading: (loading) => set({ playlistsLoading: loading }),
  setPlaylistsLoaded: (loaded) => set({ playlistsLoaded: loaded }),

  clearAll: () => set(initialState),
}));

export function getDataState(): DataState {
  return useDataStore.getState();
}

export type { DataState, DataActions };

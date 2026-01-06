import type { SongInfo, PlaylistInfo } from "../../types";

export interface DataCache {
  guessLikeSongs: SongInfo[];
  guessLoaded: boolean;
  guessLoading: boolean;

  dailySongs: SongInfo[];
  dailyLoaded: boolean;
  dailyLoading: boolean;

  createdPlaylists: PlaylistInfo[];
  collectedPlaylists: PlaylistInfo[];
  playlistsLoaded: boolean;
  playlistsLoading: boolean;
}

export const cache: DataCache = {
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

type Listener = () => void;
const listeners: Set<Listener> = new Set();

export const notifyListeners = () => {
  listeners.forEach((listener) => listener());
};

export const addListener = (listener: Listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const clearDataCache = () => {
  cache.guessLikeSongs = [];
  cache.guessLoaded = false;
  cache.guessLoading = false;

  cache.dailySongs = [];
  cache.dailyLoaded = false;
  cache.dailyLoading = false;

  cache.createdPlaylists = [];
  cache.collectedPlaylists = [];
  cache.playlistsLoaded = false;
  cache.playlistsLoading = false;

  notifyListeners();
};

export const replaceGuessLikeSongs = (songs: SongInfo[]) => {
  cache.guessLikeSongs = songs;
  cache.guessLoaded = true;
  cache.guessLoading = false;
  notifyListeners();
};

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

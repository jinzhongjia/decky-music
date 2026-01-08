/**
 * 播放器状态管理
 */

import { create } from "zustand";
import type { SongInfo, PlayMode, ParsedLyric } from "../types";

interface PlayerState {
  currentSong: SongInfo | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playlist: SongInfo[];
  currentIndex: number;
  playMode: PlayMode;
  shuffleHistory: number[];
  shuffleCursor: number;
  shufflePool: number[];
  lyric: ParsedLyric | null;
  volume: number;
  currentProviderId: string;
  loading: boolean;
  error: string;
  settingsRestored: boolean;
}

interface PlayerActions {
  setCurrentSong: (song: SongInfo | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setPlaylist: (playlist: SongInfo[]) => void;
  setCurrentIndex: (index: number) => void;
  setPlayMode: (mode: PlayMode) => void;
  setShuffleHistory: (history: number[]) => void;
  setShuffleCursor: (cursor: number) => void;
  setShufflePool: (pool: number[]) => void;
  setLyric: (lyric: ParsedLyric | null) => void;
  setVolume: (volume: number) => void;
  setCurrentProviderId: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string) => void;
  setSettingsRestored: (restored: boolean) => void;
  reset: () => void;
}

const initialState: PlayerState = {
  currentSong: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  playlist: [],
  currentIndex: -1,
  playMode: "order",
  shuffleHistory: [],
  shuffleCursor: -1,
  shufflePool: [],
  lyric: null,
  volume: 1,
  currentProviderId: "",
  loading: false,
  error: "",
  settingsRestored: false,
};

export const usePlayerStore = create<PlayerState & PlayerActions>((set) => ({
  ...initialState,
  setCurrentSong: (song) => set({ currentSong: song }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration: duration }),
  setPlaylist: (playlist) => set({ playlist: playlist }),
  setCurrentIndex: (index) => set({ currentIndex: index }),
  setPlayMode: (mode) => set({ playMode: mode }),
  setShuffleHistory: (history) => set({ shuffleHistory: history }),
  setShuffleCursor: (cursor) => set({ shuffleCursor: cursor }),
  setShufflePool: (pool) => set({ shufflePool: pool }),
  setLyric: (lyric) => set({ lyric: lyric }),
  setVolume: (volume) => set({ volume: volume }),
  setCurrentProviderId: (id) => set({ currentProviderId: id }),
  setLoading: (loading) => set({ loading: loading }),
  setError: (error) => set({ error: error }),
  setSettingsRestored: (restored) => set({ settingsRestored: restored }),
  reset: () => set(initialState),
}));

export function getPlayerState(): PlayerState {
  return usePlayerStore.getState();
}

export type { PlayerState, PlayerActions };

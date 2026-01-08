/**
 * 播放器主 Hook
 */

import type { PlayMode, SongInfo, ParsedLyric } from "../../../types";
import { usePlayerStore } from "../../../stores";
import { cleanupAudio, getAudioCurrentTime } from "../services/audioService";
import { setPreferredQuality } from "../services/persistenceService";
import { resetAllShuffleState } from "../services/shuffleService";
import { clearSkipTimeout } from "../services/playbackService";
import {
  resetQueueState,
  resetGlobalPlayerState,
  setOnPlayNextCallback,
} from "../services/queueService";
import { usePlayerEffects } from "./usePlayerEffects";
import {
  playSong,
  playPlaylist,
  addToQueue,
  removeFromQueue,
  playAtIndex,
  togglePlay,
  seek,
  stop,
  playNext,
  playPrev,
  clearCurrentQueue,
  setPlayMode,
  cyclePlayMode,
  setVolume,
  resetAllState,
  setOnNeedMoreSongs,
  enableSettingsSave as enableSettingsSaveAction,
} from "../services/playbackService";

export function cleanupPlayer(): void {
  cleanupAudio();
  resetGlobalPlayerState();
  resetQueueState();
  resetAllShuffleState();
  clearSkipTimeout();
  setOnPlayNextCallback(null);
  setOnNeedMoreSongs(null);
}

export interface UsePlayerReturn {
  currentSong: SongInfo | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  loading: boolean;
  error: string;
  lyric: ParsedLyric | null;
  playlist: SongInfo[];
  currentIndex: number;
  playMode: PlayMode;
  volume: number;
  settingsRestored: boolean;
  currentProviderId: string;

  playSong: (song: SongInfo) => Promise<void>;
  playPlaylist: (songs: SongInfo[], startIndex?: number) => Promise<void>;
  addToQueue: (songs: SongInfo[]) => Promise<void>;
  removeFromQueue: (index: number) => void;
  playAtIndex: (index: number) => Promise<void>;
  togglePlay: () => void;
  seek: (time: number) => void;
  stop: () => void;
  playNext: () => void;
  playPrev: () => void;
  setOnNeedMoreSongs: (callback: (() => Promise<SongInfo[]>) | null) => void;
  cyclePlayMode: () => void;
  setPlayMode: (mode: PlayMode) => void;
  setVolume: (volume: number, options?: { commit?: boolean }) => void;
  enableSettingsSave: (enabled: boolean) => void;
  resetAllState: () => void;
  clearCurrentQueue: () => void;
}

export function usePlayer(): UsePlayerReturn {
  usePlayerEffects();

  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const loading = usePlayerStore((s) => s.loading);
  const error = usePlayerStore((s) => s.error);
  const lyric = usePlayerStore((s) => s.lyric);
  const playlist = usePlayerStore((s) => s.playlist);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const playMode = usePlayerStore((s) => s.playMode);
  const volume = usePlayerStore((s) => s.volume);
  const settingsRestored = usePlayerStore((s) => s.settingsRestored);
  const currentProviderId = usePlayerStore((s) => s.currentProviderId);

  return {
    currentSong,
    isPlaying,
    currentTime,
    duration,
    loading,
    error,
    lyric,
    playlist,
    currentIndex,
    playMode,
    volume,
    settingsRestored,
    currentProviderId,

    playSong,
    playPlaylist,
    addToQueue,
    removeFromQueue,
    playAtIndex,
    togglePlay,
    seek,
    stop,
    playNext,
    playPrev,
    setOnNeedMoreSongs,
    cyclePlayMode,
    setPlayMode,
    setVolume,
    enableSettingsSave: enableSettingsSaveAction,
    resetAllState,
    clearCurrentQueue,
  };
}

export { getAudioCurrentTime, setPreferredQuality };

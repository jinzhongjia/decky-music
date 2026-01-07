import type { PlayMode, SongInfo } from "../../types";
import type { ParsedLyric } from "../../utils/lyricParser";
import { usePlayerStore } from "./store";
import { cleanupAudio } from "./audio";
import { setPreferredQuality } from "./persistence";
import { resetAllShuffleState } from "./shuffle";
import { clearSkipTimeout, setOnNeedMoreSongsCallback } from "./playback";
import { resetQueueState, resetGlobalPlayerState, setOnPlayNextCallback } from "./queue";
import { usePlayerEffects } from "./effects";
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
} from "./actions";

export { getAudioCurrentTime } from "./audio";
export { setPreferredQuality };
export { usePlayerStore };

// Spotify 相关导出
export { useSpotify } from "./useSpotify";
export {
  isSpotifyReady,
  getSpotifyDeviceId,
  playSpotifyTrack,
  pauseSpotify,
  resumeSpotify,
  toggleSpotifyPlay,
  seekSpotify,
  setSpotifyVolume,
  disconnectSpotify,
} from "./spotifyState";

export function cleanupPlayer(): void {
  cleanupAudio();
  resetGlobalPlayerState();
  resetQueueState();
  resetAllShuffleState();
  clearSkipTimeout();
  setOnPlayNextCallback(null);
  setOnNeedMoreSongsCallback(null);
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

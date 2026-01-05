import { toaster } from "@decky/api";
import { getSongUrl } from "../../api";
import type { SongInfo } from "../../types";
import type { ParsedLyric } from "../../utils/lyricParser";
import { usePlayerStore, getPlayerState } from "./store";
import { getGlobalAudio, setGlobalVolume } from "./audio";
import { getPreferredQuality, getFrontendSettingsCache, updateFrontendSettingsCache, resetSettingsCache } from "./persistence";
import { fetchLyricWithCache } from "./lyrics";
import { resetAllShuffleState } from "./shuffle";

let skipTimeoutId: ReturnType<typeof setTimeout> | null = null;

export function clearSkipTimeout(): void {
  if (skipTimeoutId) {
    clearTimeout(skipTimeoutId);
    skipTimeoutId = null;
  }
}

export function setSkipTimeout(callback: () => void): void {
  clearSkipTimeout();
  skipTimeoutId = setTimeout(() => {
    skipTimeoutId = null;
    callback();
  }, 2000);
}

let onNeedMoreSongsCallback: (() => Promise<SongInfo[]>) | null = null;

export function setOnNeedMoreSongsCallback(callback: (() => Promise<SongInfo[]>) | null): void {
  onNeedMoreSongsCallback = callback;
}

export function getOnNeedMoreSongsCallback(): (() => Promise<SongInfo[]>) | null {
  return onNeedMoreSongsCallback;
}

export async function playSongInternal(
  song: SongInfo,
  index: number = -1,
  autoSkipOnError: boolean = true,
  onPlayNext?: () => void,
  setLoading?: (loading: boolean) => void,
  setError?: (error: string) => void,
  setCurrentSongLocal?: (song: SongInfo | null) => void,
  setCurrentTimeLocal?: (time: number) => void,
  setDurationLocal?: (duration: number) => void,
  setIsPlayingLocal?: (playing: boolean) => void,
  setLyricLocal?: (lyric: ParsedLyric | null) => void
): Promise<boolean> {
  const audio = getGlobalAudio();
  const store = usePlayerStore.getState();

  clearSkipTimeout();

  const wasSameSong = store.currentSong?.mid === song.mid;
  const hasAnyLyric = Boolean(store.lyric);

  setLoading?.(true);
  setError?.("");
  setCurrentSongLocal?.(song);
  setCurrentTimeLocal?.(0);
  setDurationLocal?.(song.duration);

  if (!wasSameSong) {
    setLyricLocal?.(null);
    store.setLyric(null);
  } else if (store.lyric) {
    setLyricLocal?.(store.lyric);
  }

  store.setCurrentSong(song);
  if (index >= 0) {
    store.setCurrentIndex(index);
  }

  const { playlist, currentIndex, currentProviderId } = getPlayerState();
  const frontendSettings = getFrontendSettingsCache();
  if (currentProviderId) {
    updateFrontendSettingsCache({
      providerQueues: {
        ...(frontendSettings.providerQueues || {}),
        [currentProviderId]: {
          playlist,
          currentIndex,
          currentMid: playlist[currentIndex]?.mid,
        },
      },
    });
  }

  try {
    const urlResult = await getSongUrl(song.mid, getPreferredQuality(), song.name, song.singer);

    if (!urlResult.success || !urlResult.url) {
      const errorMsg = urlResult.error || "该歌曲暂时无法播放";
      setError?.(errorMsg);
      setLoading?.(false);
      toaster.toast({ title: `⚠️ ${song.name}`, body: errorMsg });

      if (autoSkipOnError && playlist.length > 1 && onPlayNext) {
        setSkipTimeout(onPlayNext);
      }
      return false;
    }

    if (urlResult.fallback_provider) {
      toaster.toast({ title: "备用音源", body: `已从 ${urlResult.fallback_provider} 获取` });
    }

    audio.src = urlResult.url;
    audio.load();

    try {
      await audio.play();
      setIsPlayingLocal?.(true);
      store.setIsPlaying(true);
      setLoading?.(false);
    } catch (e) {
      const errorMsg = (e as Error).message;
      setError?.(errorMsg);
      setLoading?.(false);
      toaster.toast({ title: "播放失败", body: errorMsg });

      if (autoSkipOnError && playlist.length > 1 && onPlayNext) {
        setSkipTimeout(onPlayNext);
      }
      return false;
    }

    if (!hasAnyLyric) {
      void fetchLyricWithCache(song.mid, song.name, song.singer, (parsed) => {
        store.setLyric(parsed);
        setLyricLocal?.(parsed);
      });
    }

    return true;
  } catch (e) {
    const errorMsg = (e as Error).message;
    setError?.(errorMsg);
    setLoading?.(false);
    toaster.toast({ title: "播放出错", body: errorMsg });
    return false;
  }
}

export function createTogglePlay(
  isPlaying: boolean,
  playSongInternalFn: (song: SongInfo, index: number, autoSkip: boolean, onNext?: () => void) => Promise<boolean>
): () => void {
  return () => {
    const audio = getGlobalAudio();
    const { currentSong, currentIndex } = getPlayerState();

    const hasValidSrc = audio.src && audio.src !== "" && audio.readyState !== HTMLMediaElement.HAVE_NOTHING;
    if (hasValidSrc) {
      if (isPlaying) {
        audio.pause();
      } else {
        audio.play().catch((e) => toaster.toast({ title: "播放失败", body: e.message }));
      }
    } else if (currentSong) {
      const resumeIndex = currentIndex >= 0 ? currentIndex : 0;
      playSongInternalFn(currentSong, resumeIndex, false);
    } else {
      toaster.toast({ title: "无法播放", body: "没有可用的音频源或当前歌曲。" });
    }
  };
}

export function createSeek(setCurrentTime: (time: number) => void): (time: number) => void {
  return (time: number) => {
    const audio = getGlobalAudio();
    if (audio.duration) {
      const clampedTime = Math.max(0, Math.min(time, audio.duration));
      audio.currentTime = clampedTime;
      setCurrentTime(clampedTime);
    }
  };
}

export function createStop(
  setCurrentSongLocal: (song: SongInfo | null) => void,
  setIsPlayingLocal: (playing: boolean) => void,
  setCurrentTimeLocal: (time: number) => void,
  setDurationLocal: (duration: number) => void,
  setErrorLocal: (error: string) => void,
  setLyricLocal: (lyric: ParsedLyric | null) => void
): () => void {
  return () => {
    const audio = getGlobalAudio();
    const store = usePlayerStore.getState();

    audio.pause();
    audio.src = "";
    clearSkipTimeout();
    setOnNeedMoreSongsCallback(null);

    store.setCurrentSong(null);
    store.setLyric(null);

    setCurrentSongLocal(null);
    setIsPlayingLocal(false);
    setCurrentTimeLocal(0);
    setDurationLocal(0);
    setErrorLocal("");
    setLyricLocal(null);
  };
}

export function createClearQueue(
  setPlaylistLocal: (playlist: SongInfo[]) => void,
  setCurrentIndexLocal: (index: number) => void
): () => void {
  return () => {
    const store = usePlayerStore.getState();
    const { currentProviderId } = getPlayerState();

    store.setPlaylist([]);
    store.setCurrentIndex(-1);
    setPlaylistLocal([]);
    setCurrentIndexLocal(-1);

    if (currentProviderId) {
      const frontendSettings = getFrontendSettingsCache();
      updateFrontendSettingsCache({
        providerQueues: {
          ...(frontendSettings.providerQueues || {}),
          [currentProviderId]: { playlist: [], currentIndex: -1 },
        },
      });
    }
  };
}

export function createResetAllState(
  stopFn: () => void,
  clearQueueFn: () => void,
  setPlayModeState: (mode: "order" | "single" | "shuffle") => void,
  setVolumeState: (volume: number) => void,
  setSettingsRestored: (restored: boolean) => void,
  enableSettingsSaveFn: (enabled: boolean) => void
): () => void {
  return () => {
    const store = usePlayerStore.getState();

    enableSettingsSaveFn(false);
    stopFn();
    clearQueueFn();

    store.setPlayMode("order");
    setGlobalVolume(1);
    resetAllShuffleState();
    resetSettingsCache();

    const audio = getGlobalAudio();
    audio.volume = 1;

    setPlayModeState("order");
    setVolumeState(1);
    setSettingsRestored(false);
  };
}

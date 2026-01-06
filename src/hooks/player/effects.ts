import { useEffect } from "react";
import type { SongInfo, FrontendSettings, StoredQueueState } from "../../types";
import { getProviderInfo } from "../../api";
import { usePlayerStore, getPlayerState } from "./store";
import { getGlobalAudio, setGlobalVolume } from "./audio";
import { ensureFrontendSettingsLoaded, getFrontendSettingsCache, loadPlayMode, loadVolume } from "./persistence";
import { fetchLyricWithCache } from "./lyrics";
import { initPlayNextHandler } from "./actions";

function loadQueueStateFromSettings(
  providerId: string,
  frontendSettings: FrontendSettings
): StoredQueueState {
  const queues = frontendSettings.providerQueues || {};
  const stored = queues[providerId];

  if (!stored) return { playlist: [], currentIndex: -1 };

  const playlist = Array.isArray(stored.playlist) ? stored.playlist : [];
  const currentIndex = typeof stored.currentIndex === "number" ? stored.currentIndex : -1;
  const currentMid = stored.currentMid;

  if (currentMid) {
    const idx = playlist.findIndex((s: SongInfo) => s.mid === currentMid);
    if (idx >= 0) {
      return { playlist, currentIndex: idx, currentMid };
    }
  }

  return {
    playlist,
    currentIndex: Math.min(Math.max(currentIndex, -1), Math.max(playlist.length - 1, -1)),
  };
}

export function useSettingsRestoration(): void {
  const settingsRestored = usePlayerStore((s) => s.settingsRestored);

  useEffect(() => {
    if (settingsRestored) return;
    let cancelled = false;

    void (async () => {
      await ensureFrontendSettingsLoaded();
      if (cancelled) return;

      const providerRes = await getProviderInfo();
      if (!providerRes.success || !providerRes.provider) {
        usePlayerStore.getState().setSettingsRestored(true);
        return;
      }

      const store = usePlayerStore.getState();
      const newProviderId = providerRes.provider.id;
      store.setCurrentProviderId(newProviderId);

      const frontendSettings = getFrontendSettingsCache();
      const { playlist: storePlaylist } = getPlayerState();
      if (storePlaylist.length === 0) {
        const stored = loadQueueStateFromSettings(newProviderId, frontendSettings);
        if (stored.playlist.length > 0) {
          store.setPlaylist([...stored.playlist]);
          const restoredIndex = stored.currentIndex >= 0 ? stored.currentIndex : 0;
          store.setCurrentIndex(restoredIndex);
          const restoredSong = stored.playlist[restoredIndex] || null;
          store.setCurrentSong(restoredSong);
        }
      }

      const restoredPlayMode = loadPlayMode();
      store.setPlayMode(restoredPlayMode);

      const restoredVolume = loadVolume();
      setGlobalVolume(restoredVolume);
      getGlobalAudio().volume = restoredVolume;
      store.setVolume(restoredVolume);

      store.setSettingsRestored(true);
    })();

    return () => { cancelled = true; };
  }, [settingsRestored]);
}

export function useLyricFetch(): void {
  const settingsRestored = usePlayerStore((s) => s.settingsRestored);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const lyric = usePlayerStore((s) => s.lyric);

  useEffect(() => {
    if (!settingsRestored || !currentSong || lyric) return;
    void fetchLyricWithCache(currentSong.mid, currentSong.name, currentSong.singer, (parsed) => {
      usePlayerStore.getState().setLyric(parsed);
    });
  }, [settingsRestored, currentSong, lyric]);
}

export function useAudioTimeSync(): void {
  useEffect(() => {
    const interval = setInterval(() => {
      const audio = getGlobalAudio();
      const store = usePlayerStore.getState();
      if (!audio.paused) {
        store.setCurrentTime(audio.currentTime);
        store.setDuration(audio.duration || 0);
        if (!store.isPlaying) {
          store.setIsPlaying(true);
        }
      } else {
        if (store.isPlaying) {
          store.setIsPlaying(false);
        }
      }
    }, 100);
    return () => clearInterval(interval);
  }, []);
}

export function usePlayNextHandler(): void {
  useEffect(() => {
    initPlayNextHandler();
  }, []);
}

export function usePlayerEffects(): void {
  useSettingsRestoration();
  useLyricFetch();
  useAudioTimeSync();
  usePlayNextHandler();
}

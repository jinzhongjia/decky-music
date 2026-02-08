/**
 * 播放器副作用 Hooks
 */

import { useEffect } from "react";
import { getProviderInfo, getLastProviderId } from "../../../api";
import { usePlayerStore, getPlayerState } from "../../../stores";
import { getGlobalAudio, setGlobalVolume } from "../services/audioService";
import {
  loadPlayModeFromBackend,
  loadVolumeFromBackend,
  loadProviderQueueFromBackend,
} from "../services/persistenceService";
import { fetchLyricWithCache } from "../services/lyricService";
import { initPlayNextHandler, initializePreferredQuality } from "../services/playbackService";

export function useSettingsRestoration(): void {
  const settingsRestored = usePlayerStore((s) => s.settingsRestored);

  useEffect(() => {
    if (settingsRestored) return;
    let cancelled = false;

    void (async () => {
      // 获取上次使用的 provider ID（用于日志或验证）
      const lastProviderRes = await getLastProviderId();
      const lastProviderId = lastProviderRes.success ? lastProviderRes.lastProviderId : null;

      const providerRes = await getProviderInfo();
      if (!providerRes.success || !providerRes.provider) {
        usePlayerStore.getState().setSettingsRestored(true);
        return;
      }

      const store = usePlayerStore.getState();
      const newProviderId = providerRes.provider.id;

      // 如果当前 provider 与上次不同，可以在这里记录或处理
      if (lastProviderId && lastProviderId !== newProviderId) {
        console.log(`Provider changed from ${lastProviderId} to ${newProviderId}`);
      }

      store.setCurrentProviderId(newProviderId);

      // 加载队列状态
      const { playlist: storePlaylist } = getPlayerState();
      if (storePlaylist.length === 0) {
        const stored = await loadProviderQueueFromBackend(newProviderId);
        if (cancelled) return;
        if (stored.playlist.length > 0) {
          store.setPlaylist([...stored.playlist]);
          const restoredIndex = stored.currentIndex >= 0 ? stored.currentIndex : 0;
          store.setCurrentIndex(restoredIndex);
          const restoredSong = stored.playlist[restoredIndex] || null;
          store.setCurrentSong(restoredSong);
        }
      }

      const restoredPlayMode = await loadPlayModeFromBackend();
      if (cancelled) return;
      store.setPlayMode(restoredPlayMode);

      const restoredVolume = await loadVolumeFromBackend();
      if (cancelled) return;
      setGlobalVolume(restoredVolume);
      getGlobalAudio().volume = restoredVolume;
      store.setVolume(restoredVolume);

      // 初始化首选音质
      await initializePreferredQuality();
      if (cancelled) return;

      store.setSettingsRestored(true);
    })();

    return () => {
      cancelled = true;
    };
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

/**
 * 同步播放状态（仅同步 isPlaying，不同步高频的 currentTime/duration）
 * currentTime 和 duration 由各组件通过 useAudioTime hook 独立获取
 */
export function useAudioPlayingSync(): void {
  useEffect(() => {
    const audio = getGlobalAudio();

    const setPlaying = (value: boolean) => {
      const store = usePlayerStore.getState();
      if (store.isPlaying !== value) {
        store.setIsPlaying(value);
      }
    };

    const syncFromAudio = () => {
      const playing = !audio.paused && !audio.ended;
      setPlaying(playing);
    };

    const handlePlay = () => setPlaying(true);
    const handlePause = () => setPlaying(false);
    const handleEnded = () => setPlaying(false);

    audio.addEventListener("play", handlePlay);
    audio.addEventListener("playing", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("waiting", handlePause);
    audio.addEventListener("ended", handleEnded);

    syncFromAudio();

    return () => {
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("playing", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("waiting", handlePause);
      audio.removeEventListener("ended", handleEnded);
    };
  }, []);
}

/** @deprecated 使用 useAudioPlayingSync 替代 */
export const useAudioTimeSync = useAudioPlayingSync;

export function usePlayNextHandler(): void {
  useEffect(() => {
    initPlayNextHandler();
  }, []);
}

export function usePlayerEffects(): void {
  useSettingsRestoration();
  useLyricFetch();
  useAudioPlayingSync();
  usePlayNextHandler();
}

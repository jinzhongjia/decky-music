import { useEffect } from "react";
import type { SongInfo, PlayMode } from "../../types";
import type { ParsedLyric } from "../../utils/lyricParser";
import { getProviderInfo } from "../../api";
import { getPlayerState } from "./store";
import { getGlobalAudio, getGlobalVolume, setGlobalEndedHandler } from "./audio";
import { ensureFrontendSettingsLoaded, getFrontendSettingsCache, loadPlayMode, loadVolume } from "./persistence";
import { fetchLyricWithCache } from "./lyrics";
import {
  broadcastPlayerState,
  subscribePlayerState,
  setOnPlayNextCallback,
  getOnPlayNextCallback,
  loadQueueStateFromSettings,
  setPlaylist as setQueuePlaylist,
  setCurrentIndex as setQueueCurrentIndex,
  setProviderId as setQueueProviderId,
  setCurrentSong as setGlobalCurrentSong,
  setLyric as setGlobalLyric,
  setPlayMode as setGlobalPlayMode,
  getPlayMode as getGlobalPlayMode,
} from "./queue";
import { setGlobalVolume } from "./audio";

type SetStateFn<T> = React.Dispatch<React.SetStateAction<T>>;

interface EffectSetters {
  setCurrentSong: SetStateFn<SongInfo | null>;
  setLyric: SetStateFn<ParsedLyric | null>;
  setPlaylist: SetStateFn<SongInfo[]>;
  setCurrentIndex: SetStateFn<number>;
  setPlayModeState: SetStateFn<PlayMode>;
  setVolumeState: SetStateFn<number>;
  setIsPlaying: SetStateFn<boolean>;
  setCurrentTime: SetStateFn<number>;
  setDuration: SetStateFn<number>;
  setCurrentProviderId: SetStateFn<string>;
  setSettingsRestored: SetStateFn<boolean>;
}

export function useSyncFromGlobals(syncFromGlobals: () => void): void {
  useEffect(() => subscribePlayerState(syncFromGlobals), [syncFromGlobals]);
}

export function useSettingsRestoration(
  settingsRestored: boolean,
  setters: Pick<EffectSetters, "setCurrentSong" | "setPlaylist" | "setCurrentIndex" | "setPlayModeState" | "setVolumeState" | "setCurrentProviderId" | "setSettingsRestored">
): void {
  const { setCurrentSong, setPlaylist, setCurrentIndex, setPlayModeState, setVolumeState, setCurrentProviderId, setSettingsRestored } = setters;

  useEffect(() => {
    if (settingsRestored) return;
    let cancelled = false;

    void (async () => {
      await ensureFrontendSettingsLoaded();
      if (cancelled) return;

      const providerRes = await getProviderInfo();
      if (!providerRes.success || !providerRes.provider) {
        setSettingsRestored(true);
        return;
      }

      const newProviderId = providerRes.provider.id;
      setQueueProviderId(newProviderId);
      setCurrentProviderId(newProviderId);

      const frontendSettings = getFrontendSettingsCache();
      const { playlist: storePlaylist } = getPlayerState();
      if (storePlaylist.length === 0) {
        const stored = loadQueueStateFromSettings(newProviderId, frontendSettings);
        if (stored.playlist.length > 0) {
          setQueuePlaylist(stored.playlist);
          const restoredIndex = stored.currentIndex >= 0 ? stored.currentIndex : 0;
          setQueueCurrentIndex(restoredIndex);
          const restoredSong = stored.playlist[restoredIndex] || null;
          setGlobalCurrentSong(restoredSong);
          setPlaylist([...stored.playlist]);
          setCurrentIndex(restoredIndex);
          setCurrentSong(restoredSong);
        }
      }

      const restoredPlayMode = loadPlayMode();
      setGlobalPlayMode(restoredPlayMode);
      setPlayModeState(restoredPlayMode);

      const restoredVolume = loadVolume();
      setGlobalVolume(restoredVolume);
      getGlobalAudio().volume = restoredVolume;
      setVolumeState(restoredVolume);

      setSettingsRestored(true);
    })();

    return () => { cancelled = true; };
  }, [settingsRestored, setCurrentSong, setPlaylist, setCurrentIndex, setPlayModeState, setVolumeState, setCurrentProviderId, setSettingsRestored]);
}

export function useLyricFetch(
  settingsRestored: boolean,
  currentSong: SongInfo | null,
  lyric: ParsedLyric | null,
  setLyric: SetStateFn<ParsedLyric | null>
): void {
  useEffect(() => {
    if (!settingsRestored || !currentSong || lyric) return;
    void fetchLyricWithCache(currentSong.mid, currentSong.name, currentSong.singer, (parsed) => {
      setGlobalLyric(parsed);
      setLyric(parsed);
      broadcastPlayerState();
    });
  }, [settingsRestored, currentSong, lyric, setLyric]);
}

export function useAudioTimeSync(
  setCurrentTime: SetStateFn<number>,
  setDuration: SetStateFn<number>,
  setIsPlaying: SetStateFn<boolean>
): void {
  useEffect(() => {
    const interval = setInterval(() => {
      const audio = getGlobalAudio();
      if (!audio.paused) {
        setCurrentTime(audio.currentTime);
        setDuration(audio.duration || 0);
        setIsPlaying(true);
      } else {
        setIsPlaying(false);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [setCurrentTime, setDuration, setIsPlaying]);
}

export function usePlayNextHandler(playNext: () => void): void {
  useEffect(() => {
    setOnPlayNextCallback(playNext);
    const endedHandler = () => {
      const pm = getGlobalPlayMode();
      const callback = getOnPlayNextCallback();
      const { playlist: pl } = getPlayerState();
      const shouldAutoContinue = pm === "single" || pm === "shuffle" || pl.length > 1;
      if (callback && shouldAutoContinue) void callback();
    };
    setGlobalEndedHandler(endedHandler);
  }, [playNext]);
}

export function createSyncFromGlobals(setters: EffectSetters): () => void {
  const { setCurrentSong, setLyric, setPlaylist, setCurrentIndex, setPlayModeState, setVolumeState, setIsPlaying, setCurrentTime, setDuration, setCurrentProviderId } = setters;
  
  return () => {
    const audio = getGlobalAudio();
    const s = getPlayerState();
    setCurrentSong(s.currentSong);
    setLyric(s.lyric);
    setPlaylist([...s.playlist]);
    setCurrentIndex(s.currentIndex);
    setPlayModeState(s.playMode);
    setVolumeState(getGlobalVolume());
    setIsPlaying(!audio.paused);
    setCurrentTime(audio.currentTime);
    setDuration(audio.duration || s.currentSong?.duration || 0);
    setCurrentProviderId(s.currentProviderId);
  };
}

import type { SongInfo, FrontendSettings, StoredQueueState, PlayMode } from "../../types";
import type { ParsedLyric } from "../../utils/lyricParser";
import { usePlayerStore, getPlayerState } from "./store";
import { getFrontendSettingsCache, updateFrontendSettingsCache } from "./persistence";

const playerSubscribers = new Set<() => void>();

function notifyPlayerSubscribers(): void {
  playerSubscribers.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });
}

export function broadcastPlayerState(): void {
  notifyPlayerSubscribers();
}

export function subscribePlayerState(callback: () => void): () => void {
  playerSubscribers.add(callback);
  return () => playerSubscribers.delete(callback);
}

export function setCurrentSong(song: SongInfo | null): void {
  usePlayerStore.getState().setCurrentSong(song);
}

export function getCurrentSong(): SongInfo | null {
  return getPlayerState().currentSong;
}

export function setLyric(lyric: ParsedLyric | null): void {
  usePlayerStore.getState().setLyric(lyric);
}

export function getLyric(): ParsedLyric | null {
  return getPlayerState().lyric;
}

export function setPlayMode(mode: PlayMode): void {
  usePlayerStore.getState().setPlayMode(mode);
}

export function getPlayMode(): PlayMode {
  return getPlayerState().playMode;
}

export function setPlaylist(playlist: SongInfo[]): void {
  usePlayerStore.getState().setPlaylist(playlist);
}

export function setCurrentIndex(index: number): void {
  usePlayerStore.getState().setCurrentIndex(index);
}

export function setProviderId(providerId: string): void {
  usePlayerStore.getState().setCurrentProviderId(providerId);
}

export function resetQueueState(): void {
  const store = usePlayerStore.getState();
  store.setPlaylist([]);
  store.setCurrentIndex(-1);
  store.setCurrentProviderId("");
}

export function resetGlobalPlayerState(): void {
  usePlayerStore.getState().reset();
  playerSubscribers.clear();
}

export function loadQueueStateFromSettings(
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
    const idx = playlist.findIndex((s) => s.mid === currentMid);
    if (idx >= 0) {
      return { playlist, currentIndex: idx, currentMid };
    }
  }

  return {
    playlist,
    currentIndex: Math.min(Math.max(currentIndex, -1), Math.max(playlist.length - 1, -1)),
  };
}

export function saveQueueState(providerId: string): void {
  if (!providerId) return;
  const { playlist, currentIndex } = getPlayerState();
  const frontendSettings = getFrontendSettingsCache();

  updateFrontendSettingsCache({
    providerQueues: {
      ...(frontendSettings.providerQueues || {}),
      [providerId]: { playlist, currentIndex, currentMid: playlist[currentIndex]?.mid },
    },
  });
}

export function clearQueueState(providerId: string): void {
  if (!providerId) return;
  const frontendSettings = getFrontendSettingsCache();
  updateFrontendSettingsCache({
    providerQueues: {
      ...(frontendSettings.providerQueues || {}),
      [providerId]: { playlist: [], currentIndex: -1 },
    },
  });
}

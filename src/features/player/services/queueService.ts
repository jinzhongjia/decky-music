/**
 * 队列服务 - 管理播放队列状态
 */

import { usePlayerStore, getPlayerState } from "../../../stores";
import type { SongInfo, PlayMode, ParsedLyric } from "../../../types";
import { loadProviderQueueFromBackend, saveProviderQueueToBackend } from "./persistenceService";

// ==================== 回调管理 ====================

let onPlayNextCallback: (() => void) | null = null;

export function setOnPlayNextCallback(callback: (() => void) | null): void {
  onPlayNextCallback = callback;
}

export function getOnPlayNextCallback(): (() => void) | null {
  return onPlayNextCallback;
}

// ==================== 订阅者系统 ====================

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

// ==================== 状态访问器 ====================

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

export function setPlayModeState(mode: PlayMode): void {
  usePlayerStore.getState().setPlayMode(mode);
}

export function getPlayModeState(): PlayMode {
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

// ==================== 重置函数 ====================

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

// ==================== 队列状态持久化 ====================

export async function saveQueueState(providerId: string): Promise<void> {
  if (!providerId) return;
  const { playlist, currentIndex } = getPlayerState();
  const currentMid = playlist[currentIndex]?.mid;
  await saveProviderQueueToBackend(providerId, playlist, currentIndex, currentMid);
}

export async function clearQueueState(providerId: string): Promise<void> {
  if (!providerId) return;
  await saveProviderQueueToBackend(providerId, [], -1);
}

export async function restoreQueueForProvider(providerId: string): Promise<void> {
  const stored = await loadProviderQueueFromBackend(providerId);
  const store = usePlayerStore.getState();

  if (stored.playlist.length > 0) {
    store.setPlaylist(stored.playlist);
    const restoredIndex = stored.currentIndex >= 0 ? stored.currentIndex : 0;
    store.setCurrentIndex(restoredIndex);
    const restoredSong = stored.playlist[restoredIndex] || null;
    store.setCurrentSong(restoredSong);
  } else {
    store.setPlaylist([]);
    store.setCurrentIndex(-1);
    store.setCurrentSong(null);
  }

  broadcastPlayerState();
}

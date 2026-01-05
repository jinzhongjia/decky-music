/**
 * 歌曲队列管理模块
 * 负责管理播放队列状态，支持按 Provider 隔离存储
 */

import type { SongInfo, FrontendSettings, StoredQueueState } from "../types";
import { usePlayerStore } from "./player/store";

// ==================== 全局队列状态 ====================

/** 当前播放列表 */
export let globalPlaylist: SongInfo[] = [];

/** 当前播放索引 */
export let globalCurrentIndex: number = -1;

/** 当前激活的 Provider ID */
export let globalCurrentProviderId: string = "";

// ==================== 队列状态管理 (按 Provider 隔离) ====================

/**
 * 获取当前 provider 的队列状态
 */
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

/**
 * 保存当前 provider 的队列状态
 */
export function saveQueueState(
  providerId: string,
  playlist: SongInfo[],
  currentIndex: number,
  currentQueues: Record<string, StoredQueueState> | undefined,
  updateSettings: (partial: Partial<FrontendSettings>) => void
) {
  if (!providerId) return;
  
  const newQueue: StoredQueueState = {
    playlist,
    currentIndex,
    currentMid: playlist[currentIndex]?.mid,
  };
  
  updateSettings({
    providerQueues: {
      ...(currentQueues || {}),
      [providerId]: newQueue,
    },
  });
}

/**
 * 清空指定 provider 的队列状态
 */
export function clearQueueState(
  providerId: string,
  currentQueues: Record<string, StoredQueueState> | undefined,
  updateSettings: (partial: Partial<FrontendSettings>) => void
) {
  if (!providerId) return;
  
  updateSettings({
    providerQueues: {
      ...(currentQueues || {}),
      [providerId]: { playlist: [], currentIndex: -1 },
    },
  });
}

/**
 * 设置播放列表
 */
export function setPlaylist(playlist: SongInfo[]) {
  globalPlaylist = playlist;
  usePlayerStore.getState().setPlaylist(playlist);
}

/**
 * 设置当前播放索引
 */
export function setCurrentIndex(index: number) {
  globalCurrentIndex = index;
  usePlayerStore.getState().setCurrentIndex(index);
}

/**
 * 设置当前 Provider ID
 */
export function setProviderId(providerId: string) {
  globalCurrentProviderId = providerId;
  usePlayerStore.getState().setCurrentProviderId(providerId);
}

/**
 * 重置队列状态
 */
export function resetQueueState() {
  globalPlaylist = [];
  globalCurrentIndex = -1;
  globalCurrentProviderId = "";
  const store = usePlayerStore.getState();
  store.setPlaylist([]);
  store.setCurrentIndex(-1);
  store.setCurrentProviderId("");
}


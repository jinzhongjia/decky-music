/**
 * 持久化服务 - 后端 API 调用封装
 */

import {
  getPlayMode as getPlayModeApi,
  setPlayMode as setPlayModeApi,
  getVolume as getVolumeApi,
  setVolume as setVolumeApi,
  getPreferredQuality as getPreferredQualityApi,
  setPreferredQuality as setPreferredQualityApi,
  getProviderQueue as getProviderQueueApi,
  saveProviderQueue as saveProviderQueueApi,
} from "../../../api";
import type { PlayMode, PreferredQuality, StoredQueueState, SongInfo } from "../../../types";

const DEFAULT_PREFERRED_QUALITY: PreferredQuality = "auto";
const QUEUE_SAVE_DEBOUNCE_MS = 400;

interface QueueSavePayload {
  providerId: string;
  playlist: SongInfo[];
  currentIndex: number;
  currentMid?: string;
}

interface PendingQueueSave {
  timerId: ReturnType<typeof setTimeout>;
  payload: QueueSavePayload;
  resolvers: Array<(result: boolean) => void>;
}

const lastQueueSnapshots = new Map<string, string>();
const pendingQueueSaves = new Map<string, PendingQueueSave>();

function buildQueueSnapshot(payload: QueueSavePayload): string {
  const mids = payload.playlist.map((song) => song.mid).join(",");
  return `${payload.currentIndex}|${payload.currentMid ?? ""}|${mids}`;
}

async function flushProviderQueueSave(providerId: string): Promise<void> {
  const pending = pendingQueueSaves.get(providerId);
  if (!pending) return;

  pendingQueueSaves.delete(providerId);

  const { payload, resolvers } = pending;
  const snapshot = buildQueueSnapshot(payload);
  if (lastQueueSnapshots.get(providerId) === snapshot) {
    resolvers.forEach((resolve) => resolve(true));
    return;
  }

  let success = false;
  try {
    const res = await saveProviderQueueApi(
      providerId,
      payload.playlist as unknown as Array<Record<string, unknown>>,
      payload.currentIndex,
      payload.currentMid
    );
    success = res.success;
    if (success) {
      lastQueueSnapshots.set(providerId, snapshot);
    }
  } catch (error) {
    console.error("Failed to save provider queue to backend:", error);
  }

  resolvers.forEach((resolve) => resolve(success));
}

/**
 * 从后端 API 加载首选音质
 */
export async function loadPreferredQualityFromBackend(): Promise<PreferredQuality> {
  try {
    const res = await getPreferredQualityApi();
    if (res.success && res.preferredQuality) {
      return res.preferredQuality;
    }
  } catch (error) {
    console.error("Failed to load preferred quality from backend:", error);
  }
  return DEFAULT_PREFERRED_QUALITY;
}

/**
 * 保存首选音质到后端 API
 */
export async function savePreferredQualityToBackend(quality: PreferredQuality): Promise<boolean> {
  try {
    const res = await setPreferredQualityApi(quality);
    return res.success;
  } catch (error) {
    console.error("Failed to save preferred quality to backend:", error);
    return false;
  }
}

/**
 * 从后端 API 加载播放模式
 */
export async function loadPlayModeFromBackend(): Promise<PlayMode> {
  try {
    const res = await getPlayModeApi();
    if (res.success && res.playMode) {
      return res.playMode;
    }
  } catch (error) {
    console.error("Failed to load play mode from backend:", error);
  }
  return "order";
}

/**
 * 保存播放模式到后端 API
 */
export async function savePlayModeToBackend(mode: PlayMode): Promise<boolean> {
  try {
    const res = await setPlayModeApi(mode);
    return res.success;
  } catch (error) {
    console.error("Failed to save play mode to backend:", error);
    return false;
  }
}

/**
 * 从后端 API 加载音量
 */
export async function loadVolumeFromBackend(): Promise<number> {
  try {
    const res = await getVolumeApi();
    if (res.success && typeof res.volume === "number") {
      // 如果音量过低（< 5%），使用默认值避免用户困惑
      const MIN_VOLUME = 0.05;
      return res.volume < MIN_VOLUME ? 1.0 : res.volume;
    }
  } catch (error) {
    console.error("Failed to load volume from backend:", error);
  }
  return 1.0;
}

/**
 * 保存音量到后端 API
 */
export async function saveVolumeToBackend(volume: number): Promise<boolean> {
  try {
    const res = await setVolumeApi(volume);
    return res.success;
  } catch (error) {
    console.error("Failed to save volume to backend:", error);
    return false;
  }
}

/**
 * 从后端 API 加载指定 Provider 的队列状态
 */
export async function loadProviderQueueFromBackend(providerId: string): Promise<StoredQueueState> {
  try {
    const res = await getProviderQueueApi(providerId);
    if (res.success && res.queue) {
      const { playlist, currentIndex, currentMid } = res.queue;
      const typedPlaylist = Array.isArray(playlist) ? (playlist as unknown as SongInfo[]) : [];

      if (currentMid) {
        const idx = typedPlaylist.findIndex((s) => s.mid === currentMid);
        if (idx >= 0) {
          lastQueueSnapshots.set(
            providerId,
            buildQueueSnapshot({
              providerId,
              playlist: typedPlaylist,
              currentIndex: idx,
              currentMid,
            })
          );
          return { playlist: typedPlaylist, currentIndex: idx, currentMid };
        }
      }

      const normalizedIndex = Math.min(
        Math.max(currentIndex, -1),
        Math.max(typedPlaylist.length - 1, -1)
      );
      const normalizedMid = typedPlaylist[normalizedIndex]?.mid;
      lastQueueSnapshots.set(
        providerId,
        buildQueueSnapshot({
          providerId,
          playlist: typedPlaylist,
          currentIndex: normalizedIndex,
          currentMid: normalizedMid,
        })
      );

      return {
        playlist: typedPlaylist,
        currentIndex: normalizedIndex,
      };
    }
  } catch (error) {
    console.error("Failed to load provider queue from backend:", error);
  }
  return { playlist: [], currentIndex: -1 };
}

/**
 * 保存指定 Provider 的队列状态到后端 API
 */
export async function saveProviderQueueToBackend(
  providerId: string,
  playlist: SongInfo[],
  currentIndex: number,
  currentMid?: string
): Promise<boolean> {
  if (!providerId) {
    return false;
  }

  const payload: QueueSavePayload = {
    providerId,
    playlist,
    currentIndex,
    currentMid,
  };
  const snapshot = buildQueueSnapshot(payload);

  if (
    lastQueueSnapshots.get(providerId) === snapshot &&
    !pendingQueueSaves.has(providerId)
  ) {
    return true;
  }

  return new Promise<boolean>((resolve) => {
    const existing = pendingQueueSaves.get(providerId);
    if (existing) {
      clearTimeout(existing.timerId);
      existing.payload = payload;
      existing.resolvers.push(resolve);
      existing.timerId = setTimeout(() => {
        void flushProviderQueueSave(providerId);
      }, QUEUE_SAVE_DEBOUNCE_MS);
      return;
    }

    const timerId = setTimeout(() => {
      void flushProviderQueueSave(providerId);
    }, QUEUE_SAVE_DEBOUNCE_MS);

    pendingQueueSaves.set(providerId, {
      timerId,
      payload,
      resolvers: [resolve],
    });
  });
}

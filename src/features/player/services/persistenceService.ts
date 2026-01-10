/**
 * 持久化服务 - 管理前端设置的保存和加载
 */

import { getFrontendSettings, saveFrontendSettings, getPlayMode as getPlayModeApi, setPlayMode as setPlayModeApi, getVolume as getVolumeApi, setVolume as setVolumeApi } from "../../../api";
import type { FrontendSettings, PlayMode, PreferredQuality, StoredQueueState, SongInfo } from "../../../types";

const DEFAULT_PREFERRED_QUALITY: PreferredQuality = "auto";

let frontendSettings: FrontendSettings = {};
let frontendSettingsLoaded = false;
let frontendSettingsPromise: Promise<void> | null = null;
let frontendSaveEnabled = true;

let saveTimeoutId: ReturnType<typeof setTimeout> | null = null;
let savePromise: Promise<void> | null = null;
let pendingSettings: FrontendSettings | null = null;
const SAVE_DEBOUNCE_MS = 300;

export async function ensureFrontendSettingsLoaded(): Promise<void> {
  if (frontendSettingsLoaded) return;
  if (frontendSettingsPromise) {
    await frontendSettingsPromise;
    return;
  }
  frontendSettingsPromise = getFrontendSettings()
    .then((res) => {
      if (res?.success && res.settings) {
        frontendSettings = { ...res.settings };
      }
      if (!frontendSettings.preferredQuality) {
        frontendSettings.preferredQuality = DEFAULT_PREFERRED_QUALITY;
      }
      frontendSettingsLoaded = true;
    })
    .catch(() => {
      frontendSettingsLoaded = true;
    })
    .finally(() => {
      frontendSettingsPromise = null;
    });
  await frontendSettingsPromise;
}

async function performSave(): Promise<void> {
  if (!pendingSettings) return;

  const settingsToSave = pendingSettings;
  pendingSettings = null;

  try {
    await saveFrontendSettings(settingsToSave as Record<string, unknown>);
  } catch {
    if (!pendingSettings) {
      pendingSettings = settingsToSave;
    }
  }
}

function scheduleSave(): void {
  if (!frontendSaveEnabled) return;

  pendingSettings = { ...frontendSettings };

  if (saveTimeoutId) {
    clearTimeout(saveTimeoutId);
    saveTimeoutId = null;
  }

  if (!savePromise) {
    saveTimeoutId = setTimeout(() => {
      saveTimeoutId = null;
      if (!pendingSettings) return;

      savePromise = performSave().finally(() => {
        savePromise = null;
        if (pendingSettings) {
          scheduleSave();
        }
      });
    }, SAVE_DEBOUNCE_MS);
  }
}

export function updateFrontendSettingsCache(
  partial: Partial<FrontendSettings>,
  commit: boolean = true
): void {
  frontendSettings = { ...frontendSettings, ...partial };
  if (commit && frontendSaveEnabled) {
    scheduleSave();
  }
}

export function getFrontendSettingsCache(): FrontendSettings {
  return frontendSettings;
}

export function getPreferredQuality(): PreferredQuality {
  const pref = frontendSettings.preferredQuality;
  if (pref === "high" || pref === "balanced" || pref === "compat" || pref === "auto") {
    return pref;
  }
  return DEFAULT_PREFERRED_QUALITY;
}

export function setPreferredQuality(quality: PreferredQuality): void {
  updateFrontendSettingsCache({ preferredQuality: quality }, true);
}

export function loadPlayMode(): PlayMode {
  const raw = frontendSettings.playMode;
  if (raw === "order" || raw === "single" || raw === "shuffle") {
    return raw;
  }
  return "order";
}

export function savePlayMode(mode: PlayMode): void {
  updateFrontendSettingsCache({ playMode: mode });
}

/**
 * 从后端 API 加载播放模式
 */
export async function loadPlayModeFromBackend(): Promise<PlayMode> {
  try {
    const res = await getPlayModeApi();
    if (res.success && res.playMode) {
      // 同步更新本地缓存
      updateFrontendSettingsCache({ playMode: res.playMode }, false);
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
    if (res.success) {
      // 同步更新本地缓存
      updateFrontendSettingsCache({ playMode: mode }, false);
      return true;
    }
  } catch (error) {
    console.error("Failed to save play mode to backend:", error);
  }
  return false;
}

export function loadVolume(): number {
  const value = frontendSettings.volume;
  if (typeof value === "number") {
    return Math.min(1, Math.max(0, value));
  }
  return 1;
}

export function saveVolume(volume: number): void {
  updateFrontendSettingsCache({ volume });
}

/**
 * 从后端 API 加载音量
 */
export async function loadVolumeFromBackend(): Promise<number> {
  try {
    const res = await getVolumeApi();
    if (res.success && typeof res.volume === "number") {
      // 同步更新本地缓存
      updateFrontendSettingsCache({ volume: res.volume }, false);
      return res.volume;
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
    if (res.success) {
      // 同步更新本地缓存
      updateFrontendSettingsCache({ volume }, false);
      return true;
    }
  } catch (error) {
    console.error("Failed to save volume to backend:", error);
  }
  return false;
}

export function enableSettingsSave(enabled: boolean): void {
  frontendSaveEnabled = enabled;
}

export function resetSettingsCache(): void {
  frontendSettings = {};
  frontendSettingsLoaded = false;
  frontendSettingsPromise = null;
}

export function loadQueueStateFromSettings(
  providerId: string,
  settings: FrontendSettings
): StoredQueueState {
  const queues = settings.providerQueues || {};
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

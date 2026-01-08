/**
 * 持久化服务 - 管理前端设置的保存和加载
 */

import { getFrontendSettings, saveFrontendSettings } from "../../../api";
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

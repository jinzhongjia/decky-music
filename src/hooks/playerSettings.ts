/**
 * 播放器设置管理模块
 * 负责前端设置的缓存、加载和保存
 */

import { getFrontendSettings, saveFrontendSettings } from "../api";
import type { FrontendSettings, PlayMode, PreferredQuality } from "../types";

const DEFAULT_PREFERRED_QUALITY: PreferredQuality = "auto";

// ==================== 设置缓存 ====================

let frontendSettings: FrontendSettings = {};
let frontendSettingsLoaded = false;
let frontendSettingsPromise: Promise<void> | null = null;
let frontendSaveEnabled = true;

/**
 * 确保前端设置已加载
 */
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

/**
 * 更新前端设置缓存
 */
export function updateFrontendSettingsCache(
  partial: Partial<FrontendSettings>,
  commit: boolean = true
): void {
  frontendSettings = { ...frontendSettings, ...partial };
  if (commit && frontendSaveEnabled) {
    void saveFrontendSettings(frontendSettings as Record<string, unknown>);
  }
}

/**
 * 获取前端设置缓存
 */
export function getFrontendSettingsCache(): FrontendSettings {
  return frontendSettings;
}

/**
 * 获取首选音质
 */
export function getPreferredQuality(): PreferredQuality {
  const pref = frontendSettings.preferredQuality;
  if (pref === "high" || pref === "balanced" || pref === "compat" || pref === "auto") {
    return pref;
  }
  return DEFAULT_PREFERRED_QUALITY;
}

/**
 * 设置首选音质
 */
export function setPreferredQuality(quality: PreferredQuality): void {
  updateFrontendSettingsCache({ preferredQuality: quality }, true);
}

/**
 * 加载播放模式
 */
export function loadPlayMode(): PlayMode {
  const raw = frontendSettings.playMode;
  if (raw === "order" || raw === "single" || raw === "shuffle") {
    return raw;
  }
  return "order";
}

/**
 * 保存播放模式
 */
export function savePlayMode(mode: PlayMode): void {
  updateFrontendSettingsCache({ playMode: mode });
}

/**
 * 加载音量
 */
export function loadVolume(): number {
  const value = frontendSettings.volume;
  if (typeof value === "number") {
    return Math.min(1, Math.max(0, value));
  }
  return 1;
}

/**
 * 保存音量
 */
export function saveVolume(volume: number): void {
  updateFrontendSettingsCache({ volume });
}

/**
 * 启用/禁用设置保存
 */
export function enableSettingsSave(enabled: boolean): void {
  frontendSaveEnabled = enabled;
}

/**
 * 重置设置缓存
 */
export function resetSettingsCache(): void {
  frontendSettings = {};
  frontendSettingsLoaded = false;
  frontendSettingsPromise = null;
}


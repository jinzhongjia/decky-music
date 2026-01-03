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

// ==================== 保存队列管理 ====================
// 使用防抖机制避免频繁保存，确保保存操作的顺序性，避免竞态问题

let saveTimeoutId: ReturnType<typeof setTimeout> | null = null;
let savePromise: Promise<void> | null = null;
let pendingSettings: FrontendSettings | null = null;
const SAVE_DEBOUNCE_MS = 300; // 防抖延迟 300ms

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
 * 执行实际的保存操作（异步，确保顺序）
 * 每次只保存一个版本，避免竞态问题
 */
async function performSave(): Promise<void> {
  if (!pendingSettings) return;
  
  // 保存当前待保存的设置，并清空 pendingSettings
  // 这样在保存期间如果有新修改，会更新 pendingSettings，保存完成后会继续保存
  const settingsToSave = pendingSettings;
  pendingSettings = null;
  
  try {
    await saveFrontendSettings(settingsToSave as Record<string, unknown>);
  } catch (error) {
    // 保存失败时，如果期间没有新修改，将设置重新加入待保存队列
    if (!pendingSettings) {
      pendingSettings = settingsToSave;
    }
    // 不抛出错误，避免影响用户体验，静默重试
  }
}

/**
 * 触发防抖保存
 * 
 * 机制说明：
 * 1. 每次调用都会更新 pendingSettings 为最新状态
 * 2. 使用防抖机制，300ms 内的多次修改只会触发一次保存
 * 3. 如果已有正在进行的保存，pendingSettings 会更新为最新状态
 * 4. 保存完成后会自动检查是否有新修改，继续保存
 * 
 * 这样可以：
 * - 避免频繁保存（防抖）
 * - 避免重复保存（同一时间只有一个保存操作）
 * - 避免竞态问题（保存操作按顺序执行）
 * - 确保最新状态被保存（pendingSettings 始终是最新的）
 */
function scheduleSave(): void {
  if (!frontendSaveEnabled) return;
  
  // 更新待保存的设置（始终使用最新状态）
  pendingSettings = { ...frontendSettings };
  
  // 清除之前的定时器（防抖：重置计时）
  if (saveTimeoutId) {
    clearTimeout(saveTimeoutId);
    saveTimeoutId = null;
  }
  
  // 如果当前没有正在进行的保存，设置新的定时器
  if (!savePromise) {
    saveTimeoutId = setTimeout(() => {
      saveTimeoutId = null;
      // 再次检查是否有待保存的设置（可能在定时器期间又有新修改）
      if (!pendingSettings) return;
      
      savePromise = performSave()
        .finally(() => {
          savePromise = null;
          // 如果保存期间有新的修改，继续保存（递归调用）
          if (pendingSettings) {
            scheduleSave();
          }
        });
    }, SAVE_DEBOUNCE_MS);
  }
  // 如果有正在进行的保存，pendingSettings 已经更新为最新状态
  // 保存完成后会自动检查并继续保存（在 performSave 的 finally 中）
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
    scheduleSave();
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


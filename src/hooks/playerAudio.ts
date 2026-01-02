/**
 * 音频实例管理模块
 * 负责管理全局 Audio 单例和相关操作
 */

// ==================== 全局音频实例 ====================

let globalAudio: HTMLAudioElement | null = null;
let globalVolume: number = 1;

/**
 * 获取或创建全局音频实例
 */
export function getGlobalAudio(): HTMLAudioElement {
  if (!globalAudio) {
    globalAudio = new Audio();
    globalAudio.preload = "auto";
    globalAudio.volume = globalVolume;
  }
  return globalAudio;
}

/**
 * 获取当前音频播放时间（秒）
 * 直接从 Audio 元素获取，用于高频动画更新
 */
export function getAudioCurrentTime(): number {
  return globalAudio?.currentTime || 0;
}

/**
 * 设置全局音量
 */
export function setGlobalVolume(volume: number): void {
  const clamped = Math.min(1, Math.max(0, volume));
  globalVolume = clamped;
  const audio = getGlobalAudio();
  if (audio.volume !== clamped) {
    audio.volume = clamped;
  }
}

/**
 * 获取全局音量
 */
export function getGlobalVolume(): number {
  return globalVolume;
}

/**
 * 设置音频的 ended 事件处理
 */
export function setAudioEndedHandler(handler: () => void): void {
  const audio = getGlobalAudio();
  audio.addEventListener("ended", handler);
}

/**
 * 清理音频实例
 */
export function cleanupAudio(): void {
  if (globalAudio) {
    globalAudio.pause();
    globalAudio.src = "";
    // 注意：不删除 globalAudio，保持单例
  }
}


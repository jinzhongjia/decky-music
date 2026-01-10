/**
 * 音频服务 - 管理 HTML Audio 元素
 */

import { usePlayerStore } from "../../../stores";

let globalAudio: HTMLAudioElement | null = null;
let globalVolume: number = 1;
let endedHandlerRegistered = false;
let errorHandlerRegistered = false;
let globalEndedHandler: (() => void) | null = null;
let globalErrorHandler: ((error: string, shouldAutoSkip: boolean) => void) | null = null;

export function setGlobalEndedHandler(handler: (() => void) | null): void {
  globalEndedHandler = handler;
}

export function setGlobalErrorHandler(handler: ((error: string, shouldAutoSkip: boolean) => void) | null): void {
  globalErrorHandler = handler;
}

function handleAudioEnded(): void {
  if (globalEndedHandler) {
    globalEndedHandler();
  }
}

function handleAudioError(event: Event): void {
  const audio = event.target as HTMLAudioElement;
  const error = audio.error;

  // 忽略空 src 的错误（通常发生在 stop() 清空 src 时）
  if (!audio.src || audio.src === "" || audio.src === window.location.href) {
    return;
  }

  let errorMsg = "音频加载失败";
  let shouldAutoSkip = false;

  if (error) {
    switch (error.code) {
      case MediaError.MEDIA_ERR_ABORTED:
        errorMsg = "音频加载被中止";
        shouldAutoSkip = false; // 可能是用户操作，不跳过
        break;
      case MediaError.MEDIA_ERR_NETWORK:
        errorMsg = "网络错误，无法加载音频\n可能是服务问题，请检查网络";
        shouldAutoSkip = false; // 系统性问题，不跳过
        break;
      case MediaError.MEDIA_ERR_DECODE:
        errorMsg = "音频解码失败，该歌曲文件可能损坏";
        shouldAutoSkip = true; // 歌曲文件问题，应跳过
        break;
      case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
        errorMsg = "音频格式不支持";
        shouldAutoSkip = true; // 歌曲文件问题，应跳过
        break;
    }
  }

  if (globalErrorHandler) {
    globalErrorHandler(errorMsg, shouldAutoSkip);
  }
}

export function getGlobalAudio(): HTMLAudioElement {
  if (!globalAudio) {
    globalAudio = new Audio();
    globalAudio.preload = "auto";
    globalAudio.volume = globalVolume;
  }
  if (!endedHandlerRegistered && globalAudio) {
    globalAudio.addEventListener("ended", handleAudioEnded);
    endedHandlerRegistered = true;
  }
  if (!errorHandlerRegistered && globalAudio) {
    globalAudio.addEventListener("error", handleAudioError);
    errorHandlerRegistered = true;
  }
  return globalAudio;
}

export function getAudioCurrentTime(): number {
  return globalAudio?.currentTime || 0;
}

export function setGlobalVolume(volume: number): void {
  const clamped = Math.min(1, Math.max(0, volume));
  globalVolume = clamped;
  const audio = getGlobalAudio();
  if (audio.volume !== clamped) {
    audio.volume = clamped;
  }
  usePlayerStore.getState().setVolume(clamped);
}

export function getGlobalVolume(): number {
  return globalVolume;
}

export function cleanupAudio(): void {
  if (globalAudio) {
    globalAudio.removeEventListener("ended", handleAudioEnded);
    globalAudio.removeEventListener("error", handleAudioError);
    globalAudio.pause();
    globalAudio.src = "";
    globalAudio = null;
  }
  endedHandlerRegistered = false;
  errorHandlerRegistered = false;
  globalEndedHandler = null;
  globalErrorHandler = null;
}

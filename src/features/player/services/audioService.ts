/**
 * 音频服务 - 管理 HTML Audio 元素
 */

import { usePlayerStore } from "../../../stores";

let globalAudio: HTMLAudioElement | null = null;
let globalVolume: number = 1;
let endedHandlerRegistered = false;
let globalEndedHandler: (() => void) | null = null;

export function setGlobalEndedHandler(handler: (() => void) | null): void {
  globalEndedHandler = handler;
}

function handleAudioEnded(): void {
  if (globalEndedHandler) {
    globalEndedHandler();
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
    globalAudio.pause();
    globalAudio.src = "";
    globalAudio = null;
  }
  endedHandlerRegistered = false;
  globalEndedHandler = null;
}

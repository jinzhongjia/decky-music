import type { SongInfo } from "../../types";

let skipTimeoutId: ReturnType<typeof setTimeout> | null = null;
let onNeedMoreSongsCallback: (() => Promise<SongInfo[]>) | null = null;

export function clearSkipTimeout(): void {
  if (skipTimeoutId) {
    clearTimeout(skipTimeoutId);
    skipTimeoutId = null;
  }
}

export function setSkipTimeout(callback: () => void): void {
  clearSkipTimeout();
  skipTimeoutId = setTimeout(() => {
    skipTimeoutId = null;
    callback();
  }, 2000);
}

export function setOnNeedMoreSongsCallback(callback: (() => Promise<SongInfo[]>) | null): void {
  onNeedMoreSongsCallback = callback;
}

export function getOnNeedMoreSongsCallback(): (() => Promise<SongInfo[]>) | null {
  return onNeedMoreSongsCallback;
}

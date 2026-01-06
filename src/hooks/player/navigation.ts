let onPlayNextCallback: (() => void) | null = null;

export function setOnPlayNextCallback(callback: (() => void) | null): void {
  onPlayNextCallback = callback;
}

export function getOnPlayNextCallback(): (() => void) | null {
  return onPlayNextCallback;
}

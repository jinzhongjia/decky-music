/**
 * 随机播放服务
 */

import { usePlayerStore, getPlayerState } from "../../../stores";

let shuffleHistory: number[] = [];
let shuffleCursor: number = -1;
let shufflePool: number[] = [];

function syncShuffleStateToStore(): void {
  const store = usePlayerStore.getState();
  store.setShuffleHistory(shuffleHistory);
  store.setShuffleCursor(shuffleCursor);
  store.setShufflePool(shufflePool);
}

function buildShufflePoolFromHistory(currentIndex: number): number[] {
  const { playlist } = getPlayerState();
  const blocked = new Set<number>(shuffleHistory);
  const pool: number[] = [];
  for (let i = 0; i < playlist.length; i += 1) {
    if (i === currentIndex) continue;
    if (blocked.has(i)) continue;
    pool.push(i);
  }
  return pool;
}

export function resetShuffleState(currentIndex: number): void {
  const { playlist } = getPlayerState();
  if (playlist.length === 0 || currentIndex < 0) {
    shuffleHistory = [];
    shuffleCursor = -1;
    shufflePool = [];
    syncShuffleStateToStore();
    return;
  }
  shuffleHistory = [currentIndex];
  shuffleCursor = 0;
  shufflePool = buildShufflePoolFromHistory(currentIndex);
  syncShuffleStateToStore();
}

export function syncShuffleAfterPlaylistChange(currentIndex: number): void {
  const { playlist } = getPlayerState();
  if (playlist.length === 0 || currentIndex < 0) {
    resetShuffleState(currentIndex);
    return;
  }

  shuffleHistory = shuffleHistory.filter((idx) => idx >= 0 && idx < playlist.length);
  const seen = new Set<number>();
  shuffleHistory = shuffleHistory.filter((idx) => {
    if (seen.has(idx)) return false;
    seen.add(idx);
    return true;
  });

  const existingPos = shuffleHistory.indexOf(currentIndex);
  if (existingPos === -1) {
    shuffleHistory = [currentIndex];
    shuffleCursor = 0;
  } else {
    shuffleHistory = shuffleHistory.slice(0, existingPos + 1);
    shuffleCursor = existingPos;
  }

  shufflePool = buildShufflePoolFromHistory(currentIndex);
  syncShuffleStateToStore();
}

export function getShuffleNextIndex(): number | null {
  const { playlist, currentIndex } = getPlayerState();
  if (playlist.length === 0) return null;

  if (shuffleCursor < 0 || shuffleHistory.length === 0) {
    resetShuffleState(currentIndex >= 0 ? currentIndex : 0);
  }

  if (shuffleCursor < shuffleHistory.length - 1) {
    shuffleCursor += 1;
    syncShuffleStateToStore();
    return shuffleHistory[shuffleCursor] ?? null;
  }

  if (shufflePool.length === 0) {
    shufflePool = buildShufflePoolFromHistory(currentIndex);
  }
  if (shufflePool.length === 0) {
    return currentIndex >= 0 ? currentIndex : null;
  }

  const pickedIdx = Math.floor(Math.random() * shufflePool.length);
  const picked = shufflePool.splice(pickedIdx, 1)[0];
  shuffleHistory.push(picked);
  shuffleCursor = shuffleHistory.length - 1;
  syncShuffleStateToStore();
  return picked ?? null;
}

export function getShufflePrevIndex(): number | null {
  const { currentIndex } = getPlayerState();
  if (shuffleCursor > 0) {
    shuffleCursor -= 1;
    syncShuffleStateToStore();
    return shuffleHistory[shuffleCursor] ?? null;
  }
  return shuffleHistory[0] ?? (currentIndex >= 0 ? currentIndex : null);
}

export function handleShuffleRemove(index: number): void {
  shuffleHistory = shuffleHistory
    .filter((idx) => idx !== index)
    .map((idx) => (idx > index ? idx - 1 : idx));
  shufflePool = shufflePool
    .filter((idx) => idx !== index)
    .map((idx) => (idx > index ? idx - 1 : idx));
  shuffleCursor = Math.min(shuffleCursor, shuffleHistory.length - 1);
  syncShuffleStateToStore();
}

export function handleShuffleAdd(newIndices: number[]): void {
  const { currentIndex } = getPlayerState();
  const blocked = new Set(shuffleHistory);
  newIndices.forEach((newIndex) => {
    if (
      !blocked.has(newIndex) &&
      !shufflePool.includes(newIndex) &&
      newIndex !== currentIndex
    ) {
      shufflePool.push(newIndex);
    }
  });
  syncShuffleStateToStore();
}

export function handleShuffleJumpTo(index: number): void {
  const existingPos = shuffleHistory.indexOf(index);
  if (existingPos >= 0) {
    shuffleHistory = shuffleHistory.slice(0, existingPos + 1);
    shuffleCursor = existingPos;
  } else {
    shuffleHistory = shuffleHistory.slice(0, Math.max(shuffleCursor, 0) + 1);
    shuffleHistory.push(index);
    shuffleCursor = shuffleHistory.length - 1;
  }
  shufflePool = buildShufflePoolFromHistory(index);
  syncShuffleStateToStore();
}

export function resetAllShuffleState(): void {
  shuffleHistory = [];
  shuffleCursor = -1;
  shufflePool = [];
  syncShuffleStateToStore();
}

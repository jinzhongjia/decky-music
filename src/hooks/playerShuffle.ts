/**
 * 随机播放状态管理模块
 * 负责管理随机播放的历史记录和下一首选择逻辑
 */

import { globalPlaylist, globalCurrentIndex } from "./useSongQueue";
import { usePlayerStore } from "./player/store";

function syncShuffleStateToStore(): void {
  const store = usePlayerStore.getState();
  store.setShuffleHistory(shuffleHistory);
  store.setShuffleCursor(shuffleCursor);
  store.setShufflePool(shufflePool);
}

// ==================== 随机播放状态 ====================

let shuffleHistory: number[] = [];
let shuffleCursor: number = -1;
let shufflePool: number[] = [];

/**
 * 从历史记录构建随机池
 */
function buildShufflePoolFromHistory(currentIndex: number): number[] {
  const blocked = new Set<number>(shuffleHistory);
  const pool: number[] = [];
  for (let i = 0; i < globalPlaylist.length; i += 1) {
    if (i === currentIndex) continue;
    if (blocked.has(i)) continue;
    pool.push(i);
  }
  return pool;
}

/**
 * 重置随机播放状态
 */
export function resetShuffleState(currentIndex: number): void {
  if (globalPlaylist.length === 0 || currentIndex < 0) {
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

/**
 * 同步随机播放状态（播放列表变化后）
 */
export function syncShuffleAfterPlaylistChange(currentIndex: number): void {
  if (globalPlaylist.length === 0 || currentIndex < 0) {
    resetShuffleState(currentIndex);
    return;
  }

  // 清理无效索引并去重，保证 currentIndex 在历史中
  shuffleHistory = shuffleHistory.filter((idx) => idx >= 0 && idx < globalPlaylist.length);
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

/**
 * 获取随机播放的下一首索引
 */
export function getShuffleNextIndex(): number | null {
  if (globalPlaylist.length === 0) return null;

  if (shuffleCursor < 0 || shuffleHistory.length === 0) {
    resetShuffleState(globalCurrentIndex >= 0 ? globalCurrentIndex : 0);
  }

  if (shuffleCursor < shuffleHistory.length - 1) {
    shuffleCursor += 1;
    syncShuffleStateToStore();
    return shuffleHistory[shuffleCursor] ?? null;
  }

  if (shufflePool.length === 0) {
    shufflePool = buildShufflePoolFromHistory(globalCurrentIndex);
  }
  if (shufflePool.length === 0) {
    return globalCurrentIndex >= 0 ? globalCurrentIndex : null;
  }

  const pickedIdx = Math.floor(Math.random() * shufflePool.length);
  const picked = shufflePool.splice(pickedIdx, 1)[0];
  shuffleHistory.push(picked);
  shuffleCursor = shuffleHistory.length - 1;
  syncShuffleStateToStore();
  return picked ?? null;
}

/**
 * 获取随机播放的上一首索引
 */
export function getShufflePrevIndex(): number | null {
  if (shuffleCursor > 0) {
    shuffleCursor -= 1;
    syncShuffleStateToStore();
    return shuffleHistory[shuffleCursor] ?? null;
  }
  return shuffleHistory[0] ?? (globalCurrentIndex >= 0 ? globalCurrentIndex : null);
}

/**
 * 处理从队列中删除歌曲时的随机状态更新
 */
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

/**
 * 处理向队列添加歌曲时的随机状态更新
 */
export function handleShuffleAdd(newIndices: number[]): void {
  const blocked = new Set(shuffleHistory);
  newIndices.forEach((newIndex) => {
    if (
      !blocked.has(newIndex) &&
      !shufflePool.includes(newIndex) &&
      newIndex !== globalCurrentIndex
    ) {
      shufflePool.push(newIndex);
    }
  });
  syncShuffleStateToStore();
}

/**
 * 处理跳转到指定索引时的随机状态更新
 */
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

/**
 * 重置所有随机播放状态
 */
export function resetAllShuffleState(): void {
  shuffleHistory = [];
  shuffleCursor = -1;
  shufflePool = [];
  syncShuffleStateToStore();
}


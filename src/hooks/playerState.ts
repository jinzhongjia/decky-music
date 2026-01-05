/**
 * 播放器全局状态管理模块
 * 负责管理全局播放状态和订阅者系统
 */

import type { SongInfo, PlayMode } from "../types";
import type { ParsedLyric } from "../utils/lyricParser";
import { usePlayerStore } from "./player/store";

// ==================== 全局状态 ====================

/** 当前播放的歌曲 */
export let globalCurrentSong: SongInfo | null = null;

/** 当前歌词 */
export let globalLyric: ParsedLyric | null = null;

/** 全局播放模式 */
export let globalPlayMode: PlayMode = "order";

// ==================== 订阅者系统 ====================

/**
 * 订阅者：用于在多个 usePlayer 实例间同步状态（侧边栏/全屏等）
 */
const playerSubscribers = new Set<() => void>();

/**
 * 通知所有订阅者
 */
function notifyPlayerSubscribers(): void {
  playerSubscribers.forEach((fn) => {
    try {
      fn();
    } catch {
      // 忽略订阅者错误
    }
  });
}

/**
 * 广播播放器状态变化
 */
export function broadcastPlayerState(): void {
  notifyPlayerSubscribers();
}

/**
 * 订阅播放器状态变化
 */
export function subscribePlayerState(callback: () => void): () => void {
  playerSubscribers.add(callback);
  return () => {
    playerSubscribers.delete(callback);
  };
}

// ==================== 状态设置函数 ====================

/**
 * 设置当前歌曲
 */
export function setGlobalCurrentSong(song: SongInfo | null): void {
  globalCurrentSong = song;
  usePlayerStore.getState().setCurrentSong(song);
}

/**
 * 获取当前歌曲
 */
export function getGlobalCurrentSong(): SongInfo | null {
  return globalCurrentSong;
}

/**
 * 设置当前歌词
 */
export function setGlobalLyric(lyric: ParsedLyric | null): void {
  globalLyric = lyric;
  usePlayerStore.getState().setLyric(lyric);
}

/**
 * 获取当前歌词
 */
export function getGlobalLyric(): ParsedLyric | null {
  return globalLyric;
}

/**
 * 设置全局播放模式
 */
export function setGlobalPlayMode(mode: PlayMode): void {
  globalPlayMode = mode;
  usePlayerStore.getState().setPlayMode(mode);
}

/**
 * 获取全局播放模式
 */
export function getGlobalPlayMode(): PlayMode {
  return globalPlayMode;
}

/**
 * 重置所有全局状态
 */
export function resetGlobalPlayerState(): void {
  globalCurrentSong = null;
  globalLyric = null;
  globalPlayMode = "order";
  playerSubscribers.clear();
  usePlayerStore.getState().reset();
}


/**
 * 歌词管理模块
 * 负责歌词的获取和解析
 * 注意：缓存功能已移除
 */

import { toaster } from "@decky/api";
import { getSongLyric } from "../api";
import type { SongInfo } from "../types";
import { parseLyric, type ParsedLyric } from "../utils/lyricParser";

// ==================== 歌词缓存（已禁用） ====================

/**
 * 获取缓存的歌词（已禁用，始终返回 null）
 */
export function getCachedLyric(_mid: string): ParsedLyric | null {
  return null;
}

/**
 * 设置缓存的歌词（已禁用，空操作）
 */
export function setCachedLyric(_mid: string, _lyric: ParsedLyric): void {
  // 缓存已禁用，不执行任何操作
}

/**
 * 检查歌词是否已缓存（已禁用，始终返回 false）
 */
export function hasCachedLyric(_mid: string): boolean {
  return false;
}

// ==================== 预取任务管理（已禁用） ====================

/**
 * 获取歌词（不再使用缓存，每次重新获取）
 */
export async function fetchLyricWithCache(
  mid: string,
  songName?: string,
  singer?: string,
  onResolved?: (parsed: ParsedLyric) => void
): Promise<ParsedLyric | null> {
  try {
    const res = await getSongLyric(mid, true, songName, singer);
    if (res.success && res.lyric) {
      const parsed = parseLyric(res.lyric, res.trans);
      onResolved?.(parsed);
      if (res.fallback_provider) {
        toaster.toast({
          title: "歌词来源",
          body: `已从 ${res.fallback_provider} 获取歌词`,
        });
      }
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 预取歌词（已禁用，空操作）
 */
export function prefetchLyric(_song: SongInfo): void {
  // 预取已禁用，不执行任何操作
}

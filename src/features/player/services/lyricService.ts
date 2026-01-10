/**
 * 歌词服务
 */

import { toaster } from "@decky/api";
import { getSongLyric } from "../../../api";
import type { ParsedLyric } from "../../../types";

export function getCachedLyric(_mid: string): ParsedLyric | null {
  return null;
}

export function setCachedLyric(_mid: string, _lyric: ParsedLyric): void {
  // 缓存已禁用
}

export function hasCachedLyric(_mid: string): boolean {
  return false;
}

export async function fetchLyricWithCache(
  mid: string,
  songName?: string,
  singer?: string,
  onResolved?: (parsed: ParsedLyric) => void
): Promise<ParsedLyric | null> {
  try {
    const res = await getSongLyric(mid, true, songName, singer);
    if (res.success && res.parsed) {
      // 后端已解析歌词，直接使用
      onResolved?.(res.parsed);
      if (res.fallback_provider) {
        toaster.toast({
          title: "歌词来源",
          body: `已从 ${res.fallback_provider} 获取歌词`,
        });
      }
      return res.parsed;
    }
    return null;
  } catch {
    return null;
  }
}

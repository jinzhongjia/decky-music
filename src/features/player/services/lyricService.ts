/**
 * 歌词服务
 */

import { toaster } from "@decky/api";
import { getSongLyric } from "../../../api";
import type { ParsedLyric } from "../../../types";

interface LyricCacheEntry {
  parsed: ParsedLyric;
  expireAt: number;
  lastAccessAt: number;
}

const LYRIC_CACHE_MAX_ENTRIES = 200;
const LYRIC_CACHE_TTL_MS = 30 * 60 * 1000;

const lyricCache = new Map<string, LyricCacheEntry>();
const lyricInFlight = new Map<string, Promise<ParsedLyric | null>>();

function toCacheKey(mid: string): string {
  return mid.trim();
}

function pruneLyricCache(now: number): void {
  for (const [key, entry] of lyricCache) {
    if (entry.expireAt <= now) {
      lyricCache.delete(key);
    }
  }

  if (lyricCache.size <= LYRIC_CACHE_MAX_ENTRIES) return;

  const entries = Array.from(lyricCache.entries()).sort(
    (a, b) => a[1].lastAccessAt - b[1].lastAccessAt
  );
  const removeCount = lyricCache.size - LYRIC_CACHE_MAX_ENTRIES;
  for (let i = 0; i < removeCount; i += 1) {
    const key = entries[i]?.[0];
    if (key) {
      lyricCache.delete(key);
    }
  }
}

export function getCachedLyric(mid: string): ParsedLyric | null {
  const key = toCacheKey(mid);
  if (!key) return null;

  const now = Date.now();
  const entry = lyricCache.get(key);
  if (!entry) return null;

  if (entry.expireAt <= now) {
    lyricCache.delete(key);
    return null;
  }

  entry.lastAccessAt = now;
  lyricCache.set(key, entry);
  return entry.parsed;
}

export function setCachedLyric(mid: string, lyric: ParsedLyric): void {
  const key = toCacheKey(mid);
  if (!key) return;

  const now = Date.now();
  lyricCache.set(key, {
    parsed: lyric,
    expireAt: now + LYRIC_CACHE_TTL_MS,
    lastAccessAt: now,
  });
  pruneLyricCache(now);
}

export function hasCachedLyric(mid: string): boolean {
  return getCachedLyric(mid) !== null;
}

export async function fetchLyricWithCache(
  mid: string,
  songName?: string,
  singer?: string,
  onResolved?: (parsed: ParsedLyric) => void
): Promise<ParsedLyric | null> {
  const key = toCacheKey(mid);
  if (!key) return null;

  const cached = getCachedLyric(key);
  if (cached) {
    onResolved?.(cached);
    return cached;
  }

  const inFlight = lyricInFlight.get(key);
  if (inFlight) {
    const sharedResult = await inFlight;
    if (sharedResult) {
      onResolved?.(sharedResult);
    }
    return sharedResult;
  }

  const requestPromise = (async () => {
    try {
      const res = await getSongLyric(mid, true, songName, singer);
      if (res.success && res.parsed) {
        setCachedLyric(key, res.parsed);
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
    } finally {
      lyricInFlight.delete(key);
    }
  })();

  lyricInFlight.set(key, requestPromise);
  const result = await requestPromise;
  if (result) {
    onResolved?.(result);
  }
  return result;
}

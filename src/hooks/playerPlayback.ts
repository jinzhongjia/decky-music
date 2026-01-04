/**
 * 播放器播放逻辑模块
 * 负责处理单首歌曲的播放流程
 */

import { toaster } from "@decky/api";
import { getSongUrl } from "../api";
import type { SongInfo } from "../types";
import { getGlobalAudio } from "./playerAudio";
import {
  setGlobalCurrentSong,
  getGlobalCurrentSong,
  setGlobalLyric,
  getGlobalLyric,
  broadcastPlayerState,
} from "./playerState";
import {
  globalPlaylist,
  globalCurrentIndex,
  globalCurrentProviderId,
  setCurrentIndex as setQueueCurrentIndex,
  saveQueueState,
} from "./useSongQueue";
import {
  getFrontendSettingsCache,
  getPreferredQuality,
  updateFrontendSettingsCache,
} from "./playerSettings";
import { fetchLyricWithCache } from "./playerLyric";

// 自动跳过的 timeout ID，用于取消
let skipTimeoutId: ReturnType<typeof setTimeout> | null = null;

/**
 * 清除跳过定时器
 */
export function clearSkipTimeout(): void {
  if (skipTimeoutId) {
    clearTimeout(skipTimeoutId);
    skipTimeoutId = null;
  }
}

/**
 * 设置跳过定时器
 */
export function setSkipTimeout(callback: () => void): void {
  clearSkipTimeout();
  skipTimeoutId = setTimeout(() => {
    skipTimeoutId = null;
    callback();
  }, 2000);
}

/**
 * 播放歌曲的内部实现
 * @param song 要播放的歌曲
 * @param index 在播放列表中的索引（-1 表示不在列表中）
 * @param autoSkipOnError 播放失败时是否自动跳过
 * @param onPlayNext 播放下一首的回调（用于自动跳过）
 * @param setLoading 设置加载状态的函数
 * @param setError 设置错误状态的函数
 * @param setCurrentSong 设置当前歌曲的函数
 * @param setCurrentTime 设置当前时间的函数
 * @param setDuration 设置时长的函数
 * @param setIsPlaying 设置播放状态的函数
 * @param setLyric 设置歌词的函数
 * @returns 是否播放成功
 */
export async function playSongInternal(
  song: SongInfo,
  index: number = -1,
  autoSkipOnError: boolean = true,
  onPlayNext?: () => void,
  setLoading?: (loading: boolean) => void,
  setError?: (error: string) => void,
  setCurrentSong?: (song: SongInfo | null) => void,
  setCurrentTime?: (time: number) => void,
  setDuration?: (duration: number) => void,
  setIsPlaying?: (playing: boolean) => void,
  setLyric?: (lyric: any) => void
): Promise<boolean> {
  const audio = getGlobalAudio();

  clearSkipTimeout();

  const wasSameSong = getGlobalCurrentSong()?.mid === song.mid;
  const hasAnyLyric = Boolean(getGlobalLyric());

  setLoading?.(true);
  setError?.("");
  setCurrentSong?.(song);
  setCurrentTime?.(0);
  setDuration?.(song.duration);

  if (!wasSameSong) {
    setLyric?.(null);
    setGlobalLyric(null);
  } else if (getGlobalLyric()) {
    setLyric?.(getGlobalLyric());
  }

  setGlobalCurrentSong(song);
  if (index >= 0) {
    setQueueCurrentIndex(index);
  }

  // 保存队列状态
  const frontendSettings = getFrontendSettingsCache();
  saveQueueState(
    globalCurrentProviderId,
    globalPlaylist,
    globalCurrentIndex,
    frontendSettings.providerQueues,
    updateFrontendSettingsCache
  );

  try {
    const urlResult = await getSongUrl(
      song.mid,
      getPreferredQuality(),
      song.name,
      song.singer
    );

    if (!urlResult.success || !urlResult.url) {
      const errorMsg = urlResult.error || "该歌曲暂时无法播放";
      setError?.(errorMsg);
      setLoading?.(false);

      toaster.toast({
        title: `⚠️ ${song.name}`,
        body: errorMsg,
      });

      if (autoSkipOnError && globalPlaylist.length > 1 && onPlayNext) {
        setSkipTimeout(onPlayNext);
      }
      return false;
    }

    if (urlResult.fallback_provider) {
      toaster.toast({
        title: "备用音源",
        body: `已从 ${urlResult.fallback_provider} 获取`,
      });
    }

    const playUrl = urlResult.url;

    audio.src = playUrl;
    audio.load();

    try {
      await audio.play();
      setIsPlaying?.(true);
      setLoading?.(false);
    } catch (e) {
      const errorMsg = (e as Error).message;
      setError?.(errorMsg);
      setLoading?.(false);
      toaster.toast({ title: "播放失败", body: errorMsg });

      if (autoSkipOnError && globalPlaylist.length > 1 && onPlayNext) {
        setSkipTimeout(onPlayNext);
      }
      return false;
    }

    if (!hasAnyLyric) {
      void fetchLyricWithCache(song.mid, song.name, song.singer, (parsed) => {
        setGlobalLyric(parsed);
        setLyric?.(parsed);
        broadcastPlayerState();
      });
    }

    broadcastPlayerState();
    return true;
  } catch (e) {
    const errorMsg = (e as Error).message;
    setError?.(errorMsg);
    setLoading?.(false);
    toaster.toast({ title: "播放出错", body: errorMsg });
    return false;
  }
}


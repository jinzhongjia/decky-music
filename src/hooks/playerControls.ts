/**
 * 播放器基础控制模块
 * 负责处理播放/暂停、跳转、停止等基础操作
 */

import { toaster } from "@decky/api";
import { getGlobalAudio, setGlobalVolume } from "./playerAudio";
import {
  setGlobalCurrentSong,
  setGlobalLyric,
  getGlobalCurrentSong,
  setGlobalPlayMode,
  broadcastPlayerState,
} from "./playerState";
import {
  globalCurrentIndex,
  globalCurrentProviderId,
  setPlaylist as setQueuePlaylist,
  setCurrentIndex as setQueueCurrentIndex,
  clearQueueState,
} from "./useSongQueue";
import {
  getFrontendSettingsCache,
  updateFrontendSettingsCache,
  resetSettingsCache,
} from "./playerSettings";
import { resetAllShuffleState } from "./playerShuffle";
import { clearSkipTimeout } from "./playerPlayback";
import { setOnNeedMoreSongsCallback } from "./playerNavigation";

/**
 * 创建切换播放/暂停的函数
 */
export function createTogglePlay(
  isPlaying: boolean,
  playSongInternalFn: (song: any, index: number, autoSkip: boolean, onNext?: () => void) => Promise<boolean>
): () => void {
  return () => {
    const audio = getGlobalAudio();

    const resumeSong = getGlobalCurrentSong();
    if (!audio.src && resumeSong) {
      const resumeIndex = globalCurrentIndex >= 0 ? globalCurrentIndex : 0;
      void playSongInternalFn(resumeSong, resumeIndex, false);
      return;
    }

    if (isPlaying) {
      audio.pause();
    } else {
      audio
        .play()
        .catch((e) => {
          toaster.toast({
            title: "播放失败",
            body: e.message,
          });
        });
    }
  };
}

/**
 * 创建跳转时间的函数
 */
export function createSeek(
  setCurrentTime: (time: number) => void
): (time: number) => void {
  return (time: number) => {
    const audio = getGlobalAudio();
    if (audio.duration) {
      const clampedTime = Math.max(0, Math.min(time, audio.duration));
      audio.currentTime = clampedTime;
      setCurrentTime(clampedTime);
    }
  };
}

/**
 * 创建停止播放的函数（只停止播放，不清空队列）
 */
export function createStop(
  setCurrentSong: (song: any) => void,
  setIsPlaying: (playing: boolean) => void,
  setCurrentTime: (time: number) => void,
  setDuration: (duration: number) => void,
  setError: (error: string) => void,
  setLyric: (lyric: any) => void
): () => void {
  return () => {
    const audio = getGlobalAudio();
    audio.pause();
    audio.src = "";

    clearSkipTimeout();

    setGlobalCurrentSong(null);
    setGlobalLyric(null);
    setOnNeedMoreSongsCallback(null);

    setCurrentSong(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setError("");
    setLyric(null);
    broadcastPlayerState();
  };
}

/**
 * 创建清空队列的函数
 */
export function createClearQueue(
  setPlaylist: (playlist: any[]) => void,
  setCurrentIndex: (index: number) => void
): () => void {
  return () => {
    setQueuePlaylist([]);
    setQueueCurrentIndex(-1);
    setPlaylist([]);
    setCurrentIndex(-1);
    
    const frontendSettings = getFrontendSettingsCache();
    if (globalCurrentProviderId) {
      clearQueueState(
        globalCurrentProviderId,
        frontendSettings.providerQueues,
        updateFrontendSettingsCache
      );
    }
    broadcastPlayerState();
  };
}

/**
 * 创建重置所有状态的函数
 */
export function createResetAllState(
  stopFn: () => void,
  clearQueueFn: () => void,
  setPlayModeState: (mode: any) => void,
  setVolumeState: (volume: number) => void,
  setSettingsRestored: (restored: boolean) => void,
  enableSettingsSave: (enabled: boolean) => void
): () => void {
  return () => {
    enableSettingsSave(false);
    stopFn();
    clearQueueFn();
    setGlobalPlayMode("order");
    setGlobalVolume(1);
    resetAllShuffleState();
    resetSettingsCache();

    const audio = getGlobalAudio();
    audio.volume = 1;

    setPlayModeState("order");
    setVolumeState(1);
    setSettingsRestored(false);
  };
}


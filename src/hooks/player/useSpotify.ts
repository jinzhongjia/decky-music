/**
 * Spotify 播放器 Hooks
 *
 * 基于 react-spotify-web-playback-sdk 库的 hooks 封装。
 */

import { useEffect } from "react";
import {
  useSpotifyPlayer,
  usePlaybackState,
  useErrorState,
  useWebPlaybackSDKReady,
  usePlayerDevice,
} from "react-spotify-web-playback-sdk";
import {
  setSpotifyDeviceId,
  setSpotifyPlayer,
} from "./spotifyState";

// ==================== 类型定义 ====================

/** 从库 hooks 推断类型 */
type SpotifyPlayer = ReturnType<typeof useSpotifyPlayer>;
type SpotifyPlaybackState = ReturnType<typeof usePlaybackState>;

interface SpotifyHookResult {
  /** 播放器是否就绪 */
  isReady: boolean;
  /** 播放器实例 */
  player: SpotifyPlayer;
  /** 当前播放状态 */
  playbackState: SpotifyPlaybackState;
  /** 错误信息 */
  error: string | null;
  /** 设备 ID */
  deviceId: string | null;
}

// ==================== Hook ====================

/**
 * 使用 Spotify 播放器
 *
 * 返回播放器状态和控制方法。
 * 必须在 SpotifySDKProvider 内部使用。
 */
export function useSpotify(): SpotifyHookResult {
  const player = useSpotifyPlayer();
  const playbackState = usePlaybackState();
  const errorState = useErrorState();
  const isReady = useWebPlaybackSDKReady();
  const device = usePlayerDevice();

  // 同步播放器实例到全局状态
  useEffect(() => {
    setSpotifyPlayer(player);
  }, [player]);

  // 同步设备 ID 到全局状态
  useEffect(() => {
    if (device?.status === "ready") {
      console.log("[Spotify] Ready with Device ID:", device.device_id);
      setSpotifyDeviceId(device.device_id);
    } else if (device?.status === "not_ready") {
      console.log("[Spotify] Device offline");
      setSpotifyDeviceId(null);
    }
  }, [device]);

  return {
    isReady,
    player,
    playbackState,
    error: errorState?.message ?? null,
    deviceId: device?.device_id ?? null,
  };
}

// 重新导出库提供的 hooks
export {
  useSpotifyPlayer,
  usePlaybackState,
  useErrorState,
  useWebPlaybackSDKReady,
};

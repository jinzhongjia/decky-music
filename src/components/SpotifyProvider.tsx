/**
 * Spotify Web Playback SDK Provider 组件
 *
 * 基于 react-spotify-web-playback-sdk 库，为应用提供 Spotify 播放能力。
 * 注意：需要 Spotify Premium 订阅才能使用播放功能。
 */

import { useCallback, useEffect } from "react";
import { WebPlaybackSDK } from "react-spotify-web-playback-sdk";
import { getSpotifyToken } from "../api";
import { setSpotifyAccessToken } from "../hooks/player/spotifyState";

// ==================== 常量 ====================

const DEVICE_NAME = "Decky Music";
const DEFAULT_VOLUME = 0.5;

// ==================== Token 缓存 ====================

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

/**
 * 获取有效的 Spotify Access Token
 */
async function fetchValidToken(): Promise<string | null> {
  const now = Date.now();

  // 如果缓存有效，直接返回
  if (cachedToken && now < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  try {
    const result = await getSpotifyToken();
    if (result.success && result.access_token) {
      cachedToken = result.access_token;
      // 假设 token 有效期 1 小时
      tokenExpiresAt = now + 3600000;
      // 同步到全局状态
      setSpotifyAccessToken(cachedToken);
      return cachedToken;
    }
  } catch (e) {
    console.error("[SpotifyProvider] Failed to fetch token:", e);
  }

  return null;
}

// ==================== Provider 组件 ====================

interface SpotifySDKProviderProps {
  children: React.ReactNode;
}

/**
 * Spotify SDK Provider 组件
 *
 * 用于初始化 Spotify Web Playback SDK，需要包裹在应用根组件中。
 */
export function SpotifySDKProvider({ children }: SpotifySDKProviderProps) {
  // SDK 需要的 token 回调
  const handleGetOAuthToken = useCallback((callback: (token: string) => void) => {
    fetchValidToken().then((token) => {
      if (token) {
        callback(token);
      }
    });
  }, []);

  // 组件挂载时预加载 token
  useEffect(() => {
    fetchValidToken();
  }, []);

  return (
    <WebPlaybackSDK
      initialDeviceName={DEVICE_NAME}
      getOAuthToken={handleGetOAuthToken}
      initialVolume={DEFAULT_VOLUME}
      connectOnInitialized={true}
    >
      {children}
    </WebPlaybackSDK>
  );
}

export default SpotifySDKProvider;

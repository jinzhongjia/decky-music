/**
 * Spotify 全局状态管理
 *
 * 用于在非 React 组件中访问 Spotify 播放器状态。
 */

// ==================== 类型定义 ====================

/** Spotify 播放器接口（简化版，仅包含需要的方法） */
interface SpotifyPlayerInstance {
  pause(): Promise<void>;
  resume(): Promise<void>;
  togglePlay(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  getCurrentState(): Promise<SpotifyPlaybackState | null>;
  disconnect(): void;
}

/** Spotify 播放状态 */
interface SpotifyPlaybackState {
  paused: boolean;
  position: number;
  duration: number;
}

// ==================== 全局状态 ====================

let accessToken: string | null = null;
let deviceId: string | null = null;
let isReady = false;

// 播放器实例引用（由 useSpotifyPlayer hook 设置）
let playerInstance: SpotifyPlayerInstance | null = null;

// ==================== 状态访问器 ====================

export function getSpotifyAccessToken(): string | null {
  return accessToken;
}

export function setSpotifyAccessToken(token: string | null): void {
  accessToken = token;
}

export function getSpotifyDeviceId(): string | null {
  return deviceId;
}

export function setSpotifyDeviceId(id: string | null): void {
  deviceId = id;
  isReady = id !== null;
}

export function isSpotifyReady(): boolean {
  return isReady && deviceId !== null;
}

export function getSpotifyPlayer(): SpotifyPlayerInstance | null {
  return playerInstance;
}

export function setSpotifyPlayer(player: SpotifyPlayerInstance | null): void {
  playerInstance = player;
}

// ==================== 播放控制 ====================

/**
 * 播放指定 Spotify 曲目
 */
export async function playSpotifyTrack(trackId: string): Promise<boolean> {
  const token = getSpotifyAccessToken();
  const device = getSpotifyDeviceId();

  if (!token || !device) {
    console.error("[Spotify] Not ready: token or device missing");
    return false;
  }

  try {
    const response = await window.fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${device}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          uris: [`spotify:track:${trackId}`],
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error("[Spotify] Play error:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[Spotify] Play track error:", error);
    return false;
  }
}

/**
 * 暂停播放
 */
export async function pauseSpotify(): Promise<void> {
  await playerInstance?.pause();
}

/**
 * 恢复播放
 */
export async function resumeSpotify(): Promise<void> {
  await playerInstance?.resume();
}

/**
 * 切换播放/暂停
 */
export async function toggleSpotifyPlay(): Promise<void> {
  await playerInstance?.togglePlay();
}

/**
 * 跳转到指定位置（毫秒）
 */
export async function seekSpotify(positionMs: number): Promise<void> {
  await playerInstance?.seek(positionMs);
}

/**
 * 设置音量 (0-1)
 */
export async function setSpotifyVolume(volume: number): Promise<void> {
  await playerInstance?.setVolume(volume);
}

/**
 * 获取当前播放状态
 */
export async function getSpotifyState(): Promise<SpotifyPlaybackState | null> {
  return (await playerInstance?.getCurrentState()) ?? null;
}

/**
 * 断开连接
 */
export function disconnectSpotify(): void {
  playerInstance?.disconnect();
  playerInstance = null;
  deviceId = null;
  isReady = false;
}

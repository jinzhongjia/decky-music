/**
 * API 响应相关类型定义
 */

import type { SongInfo, PlaylistInfo, FrontendSettings } from "./player";
import type { Capability, ProviderBasicInfo, ProviderFullInfo } from "./provider";

// ==================== 登录相关 ====================

export interface QrCodeResponse {
  success: boolean;
  qr_data?: string;
  login_type?: string;
  error?: string;
}

export type QrStatus = "waiting" | "scanned" | "timeout" | "success" | "refused" | "unknown";

export interface QrStatusResponse {
  success: boolean;
  status: QrStatus;
  logged_in?: boolean;
  musicid?: number;
  error?: string;
}

export interface LoginStatusResponse {
  logged_in: boolean;
  musicid?: number;
  encrypt_uin?: string;
  refreshed?: boolean;
  expired?: boolean;
  error?: string;
}

// ==================== 搜索相关 ====================

export interface SearchResponse {
  success: boolean;
  songs: SongInfo[];
  keyword: string;
  page: number;
  error?: string;
}

export interface HotSearchResponse {
  success: boolean;
  hotkeys: Array<{
    keyword: string;
    score: number;
  }>;
  error?: string;
}

export interface SearchSuggestResponse {
  success: boolean;
  suggestions: string[];
  error?: string;
}

// ==================== 播放相关 ====================

export interface SongUrlResponse {
  success: boolean;
  url: string;
  mid: string;
  quality?: string;
  fallback_provider?: string;
  error?: string;
}

export interface SongLyricResponse {
  success: boolean;
  lyric: string;
  trans: string;
  mid: string;
  fallback_provider?: string;
  error?: string;
}

// ==================== 推荐相关 ====================

export interface RecommendResponse {
  success: boolean;
  songs: SongInfo[];
  error?: string;
}

export interface DailyRecommendResponse {
  success: boolean;
  songs: SongInfo[];
  date?: string;
  error?: string;
}

export interface RecommendPlaylistResponse {
  success: boolean;
  playlists: PlaylistInfo[];
  error?: string;
}

// ==================== 歌单相关 ====================

export interface UserPlaylistsResponse {
  success: boolean;
  created: PlaylistInfo[];
  collected: PlaylistInfo[];
  error?: string;
}

export interface PlaylistSongsResponse {
  success: boolean;
  songs: SongInfo[];
  playlist_id: number;
  error?: string;
}

// ==================== Provider 相关 ====================

export interface ProviderSelectionResponse {
  success: boolean;
  mainProvider: string | null;
  fallbackProviders: string[];
  error?: string;
}

export interface ProviderInfoResponse {
  success: boolean;
  provider: ProviderBasicInfo | null;
  capabilities: Capability[];
  error?: string;
}

export interface ListProvidersResponse {
  success: boolean;
  providers: ProviderFullInfo[];
  error?: string;
}

export interface SwitchProviderResponse {
  success: boolean;
  error?: string;
}

// ==================== 设置相关 ====================

export interface FrontendSettingsResponse {
  success: boolean;
  settings: FrontendSettings;
}

export interface LastProviderIdResponse {
  success: boolean;
  lastProviderId: string | null;
  error?: string;
}

export interface MainProviderIdResponse {
  success: boolean;
  mainProviderId: string | null;
  error?: string;
}

export interface FallbackProviderIdsResponse {
  success: boolean;
  fallbackProviderIds: string[];
  error?: string;
}

// ==================== 更新相关 ====================

export interface UpdateInfo {
  success: boolean;
  currentVersion: string;
  latestVersion?: string;
  hasUpdate?: boolean;
  downloadUrl?: string;
  releasePage?: string;
  assetName?: string;
  notes?: string;
  error?: string;
}

export interface DownloadResult {
  success: boolean;
  path?: string;
  error?: string;
}

export interface PluginVersionResponse {
  success: boolean;
  version?: string;
  error?: string;
}

// ==================== 通用 ====================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

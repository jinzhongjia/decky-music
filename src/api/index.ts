/**
 * API 调用模块
 * 封装所有与 Python 后端的通信
 */

import { callable } from "@decky/api";
import type {
  SongInfo,
  QrCodeResponse,
  QrStatusResponse,
  SearchResponse,
  HotSearchResponse,
  SongUrlResponse,
  SongLyricResponse,
  RecommendResponse,
  DailyRecommendResponse,
  RecommendPlaylistResponse,
  UserPlaylistsResponse,
  PlaylistSongsResponse,
  FrontendSettingsResponse,
  LastProviderIdResponse,
  MainProviderIdResponse,
  FallbackProviderIdsResponse,
  UpdateInfo,
  DownloadResult,
  PluginVersionResponse,
  PreferredQuality,
  ProviderInfoResponse,
  ListProvidersResponse,
  SwitchProviderResponse,
  ProviderSelectionResponse,
} from "../types";

// ==================== 登录相关 ====================

/** 获取登录二维码 */
export const getQrCode = callable<[login_type: string], QrCodeResponse>("get_qr_code");

/** 检查二维码扫描状态 */
export const checkQrStatus = callable<[], QrStatusResponse>("check_qr_status");

/** 退出登录 */
export const logout = callable<[], { success: boolean }>("logout");

// ==================== 搜索相关 ====================

/** 搜索歌曲 */
export const searchSongs = callable<[keyword: string, page: number, num: number], SearchResponse>(
  "search_songs"
);

/** 获取热门搜索 */
export const getHotSearch = callable<[], HotSearchResponse>("get_hot_search");

/** 获取搜索建议 */
export const getSearchSuggest = callable<
  [keyword: string],
  {
    success: boolean;
    suggestions: Array<{
      type: string;
      keyword: string;
      singer?: string;
    }>;
    error?: string;
  }
>("get_search_suggest");

// ==================== 播放相关 ====================

export const getSongUrl = callable<
  [mid: string, preferredQuality?: PreferredQuality, songName?: string, singer?: string],
  SongUrlResponse
>("get_song_url");

export const getSongLyric = callable<
  [mid: string, qrc?: boolean, songName?: string, singer?: string],
  SongLyricResponse
>("get_song_lyric");

// ==================== 推荐相关 ====================

/** 获取猜你喜欢 */
export const getGuessLike = callable<[], RecommendResponse>("get_guess_like");

/** 获取每日推荐 */
export const getDailyRecommend = callable<[], DailyRecommendResponse>("get_daily_recommend");

/** 获取推荐歌单 */
export const getRecommendPlaylists = callable<[], RecommendPlaylistResponse>(
  "get_recommend_playlists"
);

/** 获取收藏歌曲 */
export const getFavSongs = callable<
  [page: number, num: number],
  {
    success: boolean;
    songs: SongInfo[];
    total: number;
    error?: string;
  }
>("get_fav_songs");

// ==================== 歌单相关 ====================

/** 获取用户歌单（创建的和收藏的） */
export const getUserPlaylists = callable<[], UserPlaylistsResponse>("get_user_playlists");

/** 获取歌单中的歌曲 */
export const getPlaylistSongs = callable<
  [playlist_id: number, dirid: number],
  PlaylistSongsResponse
>("get_playlist_songs");

// ==================== 设置相关 ====================

/** 获取前端持久化设置 */
export const getFrontendSettings = callable<[], FrontendSettingsResponse>("get_frontend_settings");

/** 保存前端持久化设置 */
export const saveFrontendSettings = callable<
  [settings: Record<string, unknown>],
  { success: boolean }
>("save_frontend_settings");

/** 获取上次使用的 Provider ID */
export const getLastProviderId = callable<[], LastProviderIdResponse>("get_last_provider_id");

/** 设置上次使用的 Provider ID */
export const setLastProviderId = callable<[providerId: string], { success: boolean; error?: string }>(
  "set_last_provider_id"
);

/** 获取主 Provider ID */
export const getMainProviderId = callable<[], MainProviderIdResponse>("get_main_provider_id");

/** 设置主 Provider ID */
export const setMainProviderId = callable<[providerId: string], { success: boolean; error?: string }>(
  "set_main_provider_id"
);

/** 获取 Fallback Provider IDs */
export const getFallbackProviderIds = callable<[], FallbackProviderIdsResponse>(
  "get_fallback_provider_ids"
);

/** 设置 Fallback Provider IDs */
export const setFallbackProviderIds = callable<
  [providerIds: string[]],
  { success: boolean; error?: string }
>("set_fallback_provider_ids");

/** 手动清除插件数据（凭证与前端设置） */
export const clearAllData = callable<[], { success: boolean; error?: string }>(
  "clear_all_settings"
);

// ==================== 更新相关 ====================

/** 检查更新 */
export const checkUpdate = callable<[], UpdateInfo>("check_update");

/** 下载更新包到 ~/Download */
export const downloadUpdate = callable<[url: string, filename?: string], DownloadResult>(
  "download_update"
);

/** 获取本地插件版本（无网络） */
export const getPluginVersion = callable<[], PluginVersionResponse>("get_plugin_version");

// ==================== Provider 相关 ====================

export const getProviderInfo = callable<[], ProviderInfoResponse>("get_provider_info");

export const listProviders = callable<[], ListProvidersResponse>("list_providers");

export const switchProvider = callable<[providerId: string], SwitchProviderResponse>(
  "switch_provider"
);

export const getProviderSelection = callable<[], ProviderSelectionResponse>(
  "get_provider_selection"
);

// ==================== 日志相关 ====================

/** 前端日志输出到后端 */
export const logFromFrontend = callable<
  [level: string, message: string, data?: Record<string, unknown>],
  { success: boolean; error?: string }
>("log_from_frontend");

/**
 * 类型定义统一导出
 */

// 播放器相关类型
export type {
  SongInfo,
  PlaylistInfo,
  PlayMode,
  LyricLine,
  LyricWord,
  QrcLyricLine,
  ParsedLyric,
  PlayerState,
  StoredQueueState,
  PreferredQuality,
  FrontendSettings,
} from "./player";

// Provider 相关类型
export type { Capability, ProviderBasicInfo, ProviderFullInfo } from "./provider";

// 导航相关类型
export { ROUTES } from "./navigation";
export type { RouteName, PageType, FullscreenPageType } from "./navigation";

// API 响应类型
export type {
  QrCodeResponse,
  QrStatus,
  QrStatusResponse,
  LoginStatusResponse,
  SearchResponse,
  HotSearchResponse,
  SearchSuggestResponse,
  SongUrlResponse,
  SongLyricResponse,
  RecommendResponse,
  DailyRecommendResponse,
  RecommendPlaylistResponse,
  UserPlaylistsResponse,
  PlaylistSongsResponse,
  ProviderSelectionResponse,
  ProviderInfoResponse,
  ListProvidersResponse,
  SwitchProviderResponse,
  FrontendSettingsResponse,
  UpdateInfo,
  DownloadResult,
  PluginVersionResponse,
  ApiResponse,
} from "./api";

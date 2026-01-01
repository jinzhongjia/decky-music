// ==================== 歌曲相关 ====================

/** 歌曲信息 */
export interface SongInfo {
  id: number;
  mid: string;
  name: string;
  singer: string;
  album: string;
  albumMid?: string;
  duration: number;
  cover: string;
  provider: string;
}

/** 歌单信息 */
export interface PlaylistInfo {
  id: number;
  dirid?: number;
  name: string;
  cover: string;
  songCount: number;
  playCount?: number;
  creator?: string;
  provider: string;
}

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

// ==================== 通用 ====================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/** 页面类型 */
export type PageType =
  | "login"
  | "home"
  | "search"
  | "player"
  | "playlists"
  | "playlist-detail"
  | "history"
  | "settings"
  | "provider-settings";

/** 用户歌单响应 */
export interface UserPlaylistsResponse {
  success: boolean;
  created: PlaylistInfo[];
  collected: PlaylistInfo[];
  error?: string;
}

/** 歌单歌曲响应 */
export interface PlaylistSongsResponse {
  success: boolean;
  songs: SongInfo[];
  playlist_id: number;
  error?: string;
}

export interface StoredQueueState {
  playlist: SongInfo[];
  currentIndex: number;
  currentMid?: string;
}

export interface FrontendSettings {
  // 按 provider ID 隔离的播放队列状态
  // key: providerId, value: 队列状态
  providerQueues?: Record<string, StoredQueueState>;
  
  // 当前激活的 provider ID（可选，也可依赖后端状态，但前端存一份方便恢复 UI）
  lastProviderId?: string;

  playMode?: PlayMode;
  volume?: number;
  sleepBackup?: {
    batteryIdle: number;
    acIdle: number;
    batterySuspend: number;
    acSuspend: number;
  };
  preferredQuality?: PreferredQuality;
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

export type PreferredQuality = "auto" | "high" | "balanced" | "compat";

export interface FrontendSettingsResponse {
  success: boolean;
  settings: FrontendSettings;
}

export interface ProviderSelectionResponse {
  success: boolean;
  mainProvider: string | null;
  fallbackProviders: string[];
  error?: string;
}

/** 播放状态 */
export interface PlayerState {
  currentSong: SongInfo | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
}

export type PlayMode = "order" | "single" | "shuffle";

// ==================== Provider 相关 ====================

/** Provider 能力类型 - 匹配后端 Capability 枚举值 */
export type Capability =
  // 认证相关
  | "auth.qr_login"
  // 搜索相关
  | "search.song"
  | "search.suggest"
  | "search.hot"
  // 播放相关
  | "play.song"
  | "play.quality.lossless"
  | "play.quality.high"
  | "play.quality.standard"
  // 歌词相关
  | "lyric.basic"
  | "lyric.word"
  | "lyric.translation"
  // 推荐相关
  | "recommend.daily"
  | "recommend.personalized"
  | "recommend.playlist"
  // 歌单相关
  | "playlist.user"
  | "playlist.favorite";

/** Provider 基本信息 */
export interface ProviderBasicInfo {
  id: string;
  name: string;
}

/** Provider 完整信息（包含能力列表） */
export interface ProviderFullInfo extends ProviderBasicInfo {
  capabilities: Capability[];
}

/** 获取当前 Provider 信息响应 */
export interface ProviderInfoResponse {
  success: boolean;
  provider: ProviderBasicInfo | null;
  capabilities: Capability[];
  error?: string;
}

/** 获取所有 Provider 列表响应 */
export interface ListProvidersResponse {
  success: boolean;
  providers: ProviderFullInfo[];
  error?: string;
}

/** 切换 Provider 响应 */
export interface SwitchProviderResponse {
  success: boolean;
  error?: string;
}

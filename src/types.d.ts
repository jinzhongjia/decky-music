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
}

// ==================== 登录相关 ====================

export interface QrCodeResponse {
  success: boolean;
  qr_data?: string;
  login_type?: string;
  error?: string;
}

export type QrStatus = 'waiting' | 'scanned' | 'timeout' | 'success' | 'refused' | 'unknown';

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
  error?: string;
}

export interface SongLyricResponse {
  success: boolean;
  lyric: string;
  trans: string;
  mid: string;
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
export type PageType = 'login' | 'home' | 'search' | 'player' | 'playlists' | 'playlist-detail' | 'history';

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

/** 播放状态 */
export interface PlayerState {
  currentSong: SongInfo | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
}

export type PlayMode = "order" | "single" | "shuffle";

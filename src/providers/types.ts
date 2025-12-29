export type ProviderId = "qqmusic" | "spotify" | "netease";

export enum Capability {
  LOGIN_QR_CODE = "login_qr_code",
  LOGIN_QR_CODE_WECHAT = "login_qr_code_wechat",
  LOGIN_OAUTH = "login_oauth",
  LOGIN_PHONE = "login_phone",
  LOGIN_PASSWORD = "login_password",

  SEARCH = "search",
  HOT_SEARCH = "hot_search",
  SEARCH_SUGGEST = "search_suggest",

  DAILY_RECOMMEND = "daily_recommend",
  PERSONALIZED = "personalized",
  RECOMMEND_PLAYLISTS = "recommend_playlists",

  USER_PLAYLISTS = "user_playlists",
  FAV_SONGS = "fav_songs",

  PLAY = "play",
  LYRICS = "lyrics",
  LYRICS_WORD_BY_WORD = "lyrics_word_by_word",
  LYRICS_TRANSLATION = "lyrics_translation",

  QUALITY_SELECTION = "quality_selection",
}

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  capabilities: Capability[];
}

export interface ProvidersResponse {
  success: boolean;
  providers: ProviderInfo[];
  current: string;
}

export interface CurrentProviderResponse {
  success: boolean;
  provider: ProviderInfo;
}

export interface SwitchProviderResponse {
  success: boolean;
  provider?: string;
  error?: string;
}

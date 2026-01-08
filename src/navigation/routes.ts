/**
 * 路由定义
 */

export const ROUTES = {
  LOGIN: "login",
  HOME: "home",
  SEARCH: "search",
  PLAYER: "player",
  PLAYLISTS: "playlists",
  PLAYLIST_DETAIL: "playlist-detail",
  HISTORY: "history",
  SETTINGS: "settings",
  PROVIDER_SETTINGS: "provider-settings",
} as const;

export type RouteName = (typeof ROUTES)[keyof typeof ROUTES];

export type PageType = RouteName;

export type FullscreenPageType = "player" | "guess-like";

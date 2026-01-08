/**
 * 导航相关类型定义
 */

/** 路由常量 */
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

/** 路由名称类型 */
export type RouteName = (typeof ROUTES)[keyof typeof ROUTES];

/** 页面类型 (兼容旧代码) */
export type PageType = RouteName;

/** 全屏播放器页面类型 */
export type FullscreenPageType = "player" | "guess-like";

import type { SongInfo } from "../../types";

export type FullscreenPageType =
  | "player"
  | "guess-like"
  | "playlists"
  | "playlist-detail"
  | "history"
  | "search"
  | "login";

/**
 * useDataManager 返回类型的简化版本
 * 用于全屏页面相关 hooks
 */
export interface UseDataManagerReturn {
  guessLikeSongs: SongInfo[];
  guessLoading: boolean;
  refreshGuessLike: () => Promise<SongInfo[]>;
  preloadData: () => void;
}

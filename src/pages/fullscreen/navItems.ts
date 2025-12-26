import type { IconType } from "react-icons";
import { FaCompactDisc, FaHeart, FaList, FaHistory, FaSearch } from "react-icons/fa";

import type { FullscreenPageType } from "./types";

export type NavItemId = Extract<
  FullscreenPageType,
  "player" | "guess-like" | "playlists" | "history" | "search"
>;

export interface NavItem {
  id: NavItemId;
  label: string;
  icon: IconType;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "player", label: "播放", icon: FaCompactDisc },
  { id: "guess-like", label: "推荐", icon: FaHeart },
  { id: "playlists", label: "歌单", icon: FaList },
  { id: "history", label: "队列", icon: FaHistory },
  { id: "search", label: "搜索", icon: FaSearch },
];

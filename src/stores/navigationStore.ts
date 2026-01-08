/**
 * 导航状态管理
 */

import { create } from "zustand";
import type { PageType, PlaylistInfo } from "../types";

interface NavigationState {
  currentPage: PageType | "loading";
  selectedPlaylist: PlaylistInfo | null;
}

interface NavigationActions {
  setCurrentPage: (page: PageType | "loading") => void;
  setSelectedPlaylist: (playlist: PlaylistInfo | null) => void;
}

export const useNavigationStore = create<NavigationState & NavigationActions>((set) => ({
  currentPage: "loading",
  selectedPlaylist: null,
  setCurrentPage: (page) => set({ currentPage: page }),
  setSelectedPlaylist: (playlist) => set({ selectedPlaylist: playlist }),
}));

export function getNavigationState(): NavigationState {
  return useNavigationStore.getState();
}

export type { NavigationState, NavigationActions };

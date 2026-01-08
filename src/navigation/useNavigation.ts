/**
 * 导航 Hook
 */

import { useCallback } from "react";
import { useNavigationStore } from "../stores";
import type { PageType, PlaylistInfo } from "../types";

export function useNavigation() {
  const currentPage = useNavigationStore((s) => s.currentPage);
  const selectedPlaylist = useNavigationStore((s) => s.selectedPlaylist);
  const setCurrentPage = useNavigationStore((s) => s.setCurrentPage);
  const setSelectedPlaylist = useNavigationStore((s) => s.setSelectedPlaylist);

  const goTo = useCallback(
    (page: PageType) => {
      setCurrentPage(page);
    },
    [setCurrentPage]
  );

  const goToLogin = useCallback(() => {
    setCurrentPage("login");
  }, [setCurrentPage]);

  const goToHome = useCallback(() => {
    setCurrentPage("home");
  }, [setCurrentPage]);

  const goToPlayer = useCallback(() => {
    setCurrentPage("player");
  }, [setCurrentPage]);

  const goToPlaylists = useCallback(() => {
    setCurrentPage("playlists");
  }, [setCurrentPage]);

  const goToPlaylistDetail = useCallback(
    (playlist: PlaylistInfo) => {
      setSelectedPlaylist(playlist);
      setCurrentPage("playlist-detail");
    },
    [setCurrentPage, setSelectedPlaylist]
  );

  const goToHistory = useCallback(() => {
    setCurrentPage("history");
  }, [setCurrentPage]);

  const goToSettings = useCallback(() => {
    setCurrentPage("settings");
  }, [setCurrentPage]);

  const goToProviderSettings = useCallback(() => {
    setCurrentPage("provider-settings");
  }, [setCurrentPage]);

  const backToHome = useCallback(() => {
    setCurrentPage("home");
  }, [setCurrentPage]);

  const backToPlaylists = useCallback(() => {
    setCurrentPage("playlists");
  }, [setCurrentPage]);

  return {
    currentPage,
    selectedPlaylist,
    goTo,
    goToLogin,
    goToHome,
    goToPlayer,
    goToPlaylists,
    goToPlaylistDetail,
    goToHistory,
    goToSettings,
    goToProviderSettings,
    backToHome,
    backToPlaylists,
  };
}

export type UseNavigationReturn = ReturnType<typeof useNavigation>;

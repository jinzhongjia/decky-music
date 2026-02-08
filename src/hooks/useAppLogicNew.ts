/**
 * 应用主逻辑 Hook - 使用新架构
 */

import { useEffect, useCallback, useMemo } from "react";
import { toaster } from "@decky/api";
import { logout, clearAllData, getProviderSelection } from "../api";
import { useNavigationStore, useAuthStore, usePlayerStore } from "../stores";
import { usePlayer } from "../features/player";
import { clearDataCache, fetchGuessLikeRaw, replaceGuessLikeSongs } from "../features/data";
import { useMountedRef } from "./useMountedRef";
import { useSteamInput } from "./useSteamInput";
import { clearRecommendCache } from "../pages/sidebar/HomePage";
import type { SongInfo, PlaylistInfo, PageType } from "../types";
import type { NavigationHandlers, DataHandlers } from "../navigation/Router";

export function useAppLogicNew() {
  // 使用新的 navigation store
  const currentPage = useNavigationStore((s) => s.currentPage);
  const selectedPlaylist = useNavigationStore((s) => s.selectedPlaylist);
  const setCurrentPage = useNavigationStore((s) => s.setCurrentPage);
  const setSelectedPlaylist = useNavigationStore((s) => s.setSelectedPlaylist);

  // 使用新的 auth store
  const setLoggedIn = useAuthStore((s) => s.setLoggedIn);

  const mountedRef = useMountedRef();

  const player = usePlayer();
  const {
    playPlaylist,
    playSong,
    setOnNeedMoreSongs,
    addToQueue,
    resetAllState,
  } = player;

  const hasCurrentSong = usePlayerStore((s) => s.currentSong !== null);

  // Handle controller input
  useSteamInput({
    player,
    currentPage: currentPage === "loading" ? "login" : currentPage as PageType,
    setCurrentPage: (page) => setCurrentPage(page),
  });

  const checkLoginStatus = useCallback(async () => {
    try {
      const result = await getProviderSelection();
      if (!mountedRef.current) return;

      const isLoggedIn = Boolean(result.success && result.mainProvider);

      setCurrentPage(isLoggedIn ? "home" : "login");
      setLoggedIn(isLoggedIn);
    } catch {
      if (!mountedRef.current) return;
      setCurrentPage("login");
      setLoggedIn(false);
    }
  }, [mountedRef, setCurrentPage, setLoggedIn]);

  useEffect(() => {
    checkLoginStatus();
  }, [checkLoginStatus]);

  const handleLoginSuccess = useCallback(() => {
    setLoggedIn(true);
    setCurrentPage("home");
  }, [setLoggedIn, setCurrentPage]);

  const handleLogout = useCallback(async () => {
    await logout();
    player.clearCurrentQueue();
    clearRecommendCache();
    clearDataCache();
    setCurrentPage("login");
    setLoggedIn(false);
  }, [player, setCurrentPage, setLoggedIn]);

  const fetchMoreGuessLikeSongs = useCallback(async (): Promise<SongInfo[]> => {
    const songs = await fetchGuessLikeRaw();
    if (songs.length > 0) {
      replaceGuessLikeSongs(songs);
    }
    return songs;
  }, []);

  const handleSelectSong = useCallback(
    async (song: SongInfo, playlist?: SongInfo[], source?: string) => {
      if (playlist && playlist.length > 0) {
        const index = playlist.findIndex((s) => s.mid === song.mid);
        playPlaylist(playlist, index >= 0 ? index : 0).catch(() => {});

        if (source === "guess-like") {
          setOnNeedMoreSongs(fetchMoreGuessLikeSongs);
        } else {
          setOnNeedMoreSongs(null);
        }
      } else {
        playSong(song).catch(() => {});
        setOnNeedMoreSongs(null);
      }
    },
    [fetchMoreGuessLikeSongs, playPlaylist, playSong, setOnNeedMoreSongs]
  );

  const handleClearAllData = useCallback(async () => {
    const res = await clearAllData();
    if (!res.success) {
      throw new Error(res.error || "清除失败");
    }

    resetAllState();
    clearDataCache();
    setSelectedPlaylist(null);
    setCurrentPage("login");
    setLoggedIn(false);
    return true;
  }, [resetAllState, setSelectedPlaylist, setCurrentPage, setLoggedIn]);

  const handleSelectPlaylist = useCallback(
    (playlist: PlaylistInfo) => {
      setSelectedPlaylist(playlist);
      setCurrentPage("playlist-detail");
    },
    [setSelectedPlaylist, setCurrentPage]
  );

  const handleAddSongToQueue = useCallback(
    async (song: SongInfo) => {
      await addToQueue([song]);
      toaster.toast({
        title: "已添加到播放队列",
        body: song.name,
      });
    },
    [addToQueue]
  );

  const handleAddPlaylistToQueue = useCallback(
    async (songs: SongInfo[]) => {
      if (!songs || songs.length === 0) return;
      await addToQueue(songs);
      toaster.toast({
        title: "已添加到播放队列",
        body: `加入 ${songs.length} 首歌曲`,
      });
    },
    [addToQueue]
  );

  const nav: NavigationHandlers = useMemo(
    () => ({
      onLoginSuccess: handleLoginSuccess,
      onLogout: handleLogout,
      onGoToPlaylists: () => setCurrentPage("playlists"),
      onGoToHistory: () => setCurrentPage("history"),
      onGoToSettings: () => setCurrentPage("settings"),
      onGoToProviderSettings: () => setCurrentPage("provider-settings"),
      onBackToHome: () => setCurrentPage("home"),
      onBackToPlaylists: () => setCurrentPage("playlists"),
      onGoToLogin: () => setCurrentPage("login"),
      onGoToPlayer: () => {
        if (hasCurrentSong) {
          setCurrentPage("player");
        }
      },
      onClearAllData: handleClearAllData,
    }),
    [handleLoginSuccess, handleLogout, handleClearAllData, hasCurrentSong, setCurrentPage]
  );

  const data: DataHandlers = useMemo(
    () => ({
      onSelectSong: handleSelectSong,
      onSelectPlaylist: handleSelectPlaylist,
      onAddSongToQueue: handleAddSongToQueue,
      onAddPlaylistToQueue: handleAddPlaylistToQueue,
    }),
    [handleSelectSong, handleSelectPlaylist, handleAddSongToQueue, handleAddPlaylistToQueue]
  );

  return {
    state: {
      currentPage,
      selectedPlaylist,
    },
    player,
    nav,
    data,
  };
}

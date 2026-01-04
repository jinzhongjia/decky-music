import { useState, useEffect, useCallback, useMemo } from "react";
import { toaster } from "@decky/api";
import { logout, clearAllData, getProviderSelection } from "../api";
import { setAuthLoggedIn } from "../state/authState";
import { clearDataCache, fetchGuessLikeRaw, replaceGuessLikeSongs } from "./useDataManager";
import { usePlayer } from "./usePlayer";
import { useMountedRef } from "./useMountedRef";
import { useSteamInput } from "./useSteamInput";
import { clearRecommendCache } from "../components/HomePage";
import { menuManager } from "../patches";
import type { PageType, SongInfo, PlaylistInfo } from "../types";
import type { NavigationHandlers, DataHandlers } from "../components/Router";

export function useAppLogic() {
  const [currentPage, setCurrentPage] = useState<PageType | "loading">("loading");
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistInfo | null>(null);
  const mountedRef = useMountedRef();

  const player = usePlayer();
  const { 
    playPlaylist, 
    playSong, 
    setOnNeedMoreSongs, 
    addToQueue, 
    enableSettingsSave,
    resetAllState
  } = player;

  // Handle controller input
  useSteamInput({
    player,
    currentPage: currentPage === "loading" ? "login" : currentPage,
    setCurrentPage: (page) => setCurrentPage(page),
  });

  const checkLoginStatus = useCallback(async () => {
    try {
      const result = await getProviderSelection();
      if (!mountedRef.current) return;

      // 如果 mainProvider 有值，则认为已登录
      const isLoggedIn = Boolean(result.success && result.mainProvider);

      setCurrentPage(isLoggedIn ? "home" : "login");
      setAuthLoggedIn(isLoggedIn);

      if (isLoggedIn) {
        menuManager.enable();
      }
    } catch {
      if (!mountedRef.current) return;
      setCurrentPage("login");
      setAuthLoggedIn(false);
    }
  }, [mountedRef]);

  useEffect(() => {
    checkLoginStatus();
  }, [checkLoginStatus]);

  const handleLoginSuccess = useCallback(() => {
    enableSettingsSave(true);
    setAuthLoggedIn(true);
    setCurrentPage("home");
    menuManager.enable();
  }, [enableSettingsSave]);

  const handleLogout = useCallback(async () => {
    enableSettingsSave(false);
    await logout();
    player.clearCurrentQueue(); // 登出时清空队列
    clearRecommendCache();
    clearDataCache();
    menuManager.disable();
    setCurrentPage("login");
    setAuthLoggedIn(false);
  }, [enableSettingsSave, player]);

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

    enableSettingsSave(false);
    resetAllState();
    clearDataCache();
    menuManager.disable();
    setSelectedPlaylist(null);
    setCurrentPage("login");
    setAuthLoggedIn(false);
    return true;
  }, [enableSettingsSave, resetAllState]);

  const handleSelectPlaylist = useCallback((playlist: PlaylistInfo) => {
    setSelectedPlaylist(playlist);
    setCurrentPage("playlist-detail");
  }, []);

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

  // Navigation handlers
  const nav: NavigationHandlers = useMemo(() => ({
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
      // Only allow navigation if song is playing/loaded
      if (player.currentSong) {
        setCurrentPage("player");
      }
    },
    onClearAllData: handleClearAllData,
  }), [handleLoginSuccess, handleLogout, handleClearAllData, player.currentSong]);

  // Data handlers
  const data: DataHandlers = useMemo(() => ({
    onSelectSong: handleSelectSong,
    onSelectPlaylist: handleSelectPlaylist,
    onAddSongToQueue: handleAddSongToQueue,
    onAddPlaylistToQueue: handleAddPlaylistToQueue,
  }), [handleSelectSong, handleSelectPlaylist, handleAddSongToQueue, handleAddPlaylistToQueue]);

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

import { useState, useEffect, useCallback } from "react";
import { toaster } from "@decky/api";
import { logout, clearAllData, getProviderSelection } from "../api";
import { setAuthLoggedIn } from "../state/authState";
import {
  preloadData,
  clearDataCache,
  fetchGuessLikeRaw,
  replaceGuessLikeSongs,
} from "./useDataManager";
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

  // Handle controller input
  useSteamInput({ 
    player, 
    currentPage: currentPage === "loading" ? "login" : currentPage, 
    setCurrentPage: (page) => setCurrentPage(page) 
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
    } catch (e) {
      console.error("检查登录状态失败:", e);
      if (!mountedRef.current) return;
      setCurrentPage("login");
      setAuthLoggedIn(false);
    }
  }, [mountedRef]);

  useEffect(() => {
    checkLoginStatus();
  }, [checkLoginStatus]);

  const handleLoginSuccess = useCallback(() => {
    player.enableSettingsSave(true);
    setAuthLoggedIn(true);
    setCurrentPage("home");
    menuManager.enable();
  }, [player]);

  const handleLogout = useCallback(async () => {
    player.enableSettingsSave(false);
    await logout();
    player.stop();
    clearRecommendCache();
    clearDataCache();
    menuManager.disable();
    setCurrentPage("login");
    setAuthLoggedIn(false);
  }, [player]);

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
        await player.playPlaylist(playlist, index >= 0 ? index : 0);

        if (source === "guess-like") {
          player.setOnNeedMoreSongs(fetchMoreGuessLikeSongs);
        } else {
          player.setOnNeedMoreSongs(null);
        }
      } else {
        await player.playSong(song);
        player.setOnNeedMoreSongs(null);
      }
    },
    [fetchMoreGuessLikeSongs, player]
  );

  const handleClearAllData = useCallback(async () => {
    const res = await clearAllData();
    if (!res.success) {
      throw new Error(res.error || "清除失败");
    }

    player.enableSettingsSave(false);
    player.resetAllState();
    clearDataCache();
    menuManager.disable();
    setSelectedPlaylist(null);
    setCurrentPage("login");
    setAuthLoggedIn(false);
    return true;
  }, [player]);

  const handleSelectPlaylist = useCallback((playlist: PlaylistInfo) => {
    setSelectedPlaylist(playlist);
    setCurrentPage("playlist-detail");
  }, []);

  const handleAddSongToQueue = useCallback(
    async (song: SongInfo) => {
      await player.addToQueue([song]);
      toaster.toast({
        title: "已添加到播放队列",
        body: song.name,
      });
    },
    [player]
  );

  const handleAddPlaylistToQueue = useCallback(
    async (songs: SongInfo[]) => {
      if (!songs || songs.length === 0) return;
      await player.addToQueue(songs);
      toaster.toast({
        title: "已添加到播放队列",
        body: `加入 ${songs.length} 首歌曲`,
      });
    },
    [player]
  );


  // Navigation handlers
  const nav: NavigationHandlers = {
    onLoginSuccess: handleLoginSuccess,
    onLogout: handleLogout,
    onGoToSearch: useCallback(() => setCurrentPage("search"), []),
    onGoToPlaylists: useCallback(() => setCurrentPage("playlists"), []),
    onGoToHistory: useCallback(() => setCurrentPage("history"), []),
    onGoToSettings: useCallback(() => setCurrentPage("settings"), []),
    onBackToHome: useCallback(() => setCurrentPage("home"), []),
    onBackToPlaylists: useCallback(() => setCurrentPage("playlists"), []),
    onGoToLogin: useCallback(() => setCurrentPage("login"), []),
    onGoToPlayer: useCallback(() => {
        // Only allow navigation if song is playing/loaded
        if (player.currentSong) {
            setCurrentPage("player");
        }
    }, [player.currentSong]),
    onClearAllData: handleClearAllData,
  };

  // Data handlers
  const data: DataHandlers = {
    onSelectSong: handleSelectSong,
    onSelectPlaylist: handleSelectPlaylist,
    onAddSongToQueue: handleAddSongToQueue,
    onAddPlaylistToQueue: handleAddPlaylistToQueue,
  };

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

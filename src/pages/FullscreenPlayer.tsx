/* global HTMLDivElement, HTMLElement, requestAnimationFrame */

import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoginPage } from "../components";
import { getProviderSelection } from "../api";
import { setAuthLoggedIn, useAuthStatus } from "../features/auth";
import { useDataManager } from "../features/data";
import { useProvider } from "../hooks/useProvider";
import { useMountedRef } from "../hooks/useMountedRef";
import { usePlayer } from "../features/player";
import { usePlayerStore } from "../stores";
import { useAutoLoadGuessLike } from "../hooks/useAutoLoadGuessLike";
import { seek as seekAction, togglePlay as togglePlayAction } from "../features/player/services/playbackService";
import { FaListOl, FaRandom, FaRedo } from "react-icons/fa";
import { NavBar } from "./fullscreen/NavBar";
import { PlayerPage } from "./fullscreen/PlayerPage";
import { useFullscreenGamepad } from "./fullscreen/useFullscreenGamepad";
import { useFullscreenHandlers } from "./fullscreen/useFullscreenHandlers";
import { useFullscreenContent } from "./fullscreen/useFullscreenContent";
import type { PlaylistInfo } from "../types";
import type { FullscreenPageType } from "./fullscreen/types";

const SYSTEM_TOP_BAR_HEIGHT = 40;
const SYSTEM_BOTTOM_BAR_HEIGHT = 40;

export const FullscreenPlayer: FC = () => {
  const [currentPage, setCurrentPage] = useState<FullscreenPageType>('player');
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistInfo | null>(null);
  const isLoggedIn = useAuthStatus();
  const mountedRef = useMountedRef();
  const playerPageRef = useRef<HTMLDivElement>(null);

  const player = usePlayer();
  const dataManager = useDataManager();
  const { provider } = useProvider();

  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const duration = usePlayerStore((s) => s.duration);
  const playMode = usePlayerStore((s) => s.playMode);

  const { preloadData } = dataManager;

  const isNetease = provider?.id === "netease";
  const currentPlayingMid = currentSong?.mid;

  const playModeConfig = useMemo(() => {
    switch (playMode) {
      case "shuffle":
        return { icon: <FaRandom size={14} />, title: "随机播放" };
      case "single":
        return { icon: <FaRedo size={14} />, title: "单曲循环" };
      default:
        return { icon: <FaListOl size={14} />, title: "顺序播放" };
    }
  }, [playMode]);

  const handleLyricSeek = useCallback((timeSec: number) => {
    if (!currentSong) return;
    const total = duration || currentSong.duration || 0;
    if (!total || !isFinite(total)) return;
    const clamped = Math.max(0, Math.min(timeSec, total));
    seekAction(clamped);
    if (!isPlaying) {
      togglePlayAction();
    }
  }, [currentSong, duration, isPlaying]);

  const navigateToPage = setCurrentPage;

  const checkLoginStatus = useCallback(async () => {
    try {
      const result = await getProviderSelection();
      if (!mountedRef.current) return;
      const loggedIn = Boolean(result.success && result.mainProvider);
      setAuthLoggedIn(loggedIn);
    } catch {
      // ignore
    }
  }, [mountedRef]);

  useEffect(() => {
    if (isLoggedIn === false || isLoggedIn === true) return;
    checkLoginStatus();
  }, [isLoggedIn, checkLoginStatus]);

  useAutoLoadGuessLike(currentPage === 'guess-like');

  useFullscreenGamepad(player, currentPage, navigateToPage);

  const {
    handleSelectSong,
    handleSelectPlaylist: handleSelectPlaylistRaw,
    handleAddPlaylistToQueue,
  } = useFullscreenHandlers(player, dataManager, navigateToPage);

  const handleSelectPlaylist = useCallback((playlistInfo: PlaylistInfo) => {
    setSelectedPlaylist(playlistInfo);
    handleSelectPlaylistRaw(playlistInfo);
  }, [handleSelectPlaylistRaw]);

  const handleLoginSuccess = useCallback(() => {
    setAuthLoggedIn(true);
    navigateToPage('player');
    preloadData();
  }, [navigateToPage, preloadData]);

  const goBackToPlayer = useCallback(() => navigateToPage('player'), [navigateToPage]);
  const goBackToPlaylists = useCallback(() => navigateToPage('playlists'), [navigateToPage]);

  const {
    pageRefs,
    content,
  } = useFullscreenContent({
    player,
    dataManager,
    selectedPlaylist,
    currentPlayingMid,
    isNetease,
    onSelectSong: handleSelectSong,
    onSelectPlaylist: handleSelectPlaylist,
    onAddPlaylistToQueue: handleAddPlaylistToQueue,
    onRefreshGuessLike: () => dataManager.refreshGuessLike(),
    goBackToPlayer,
    goBackToPlaylists,
  });

  const focusCurrentPage = useCallback((page: FullscreenPageType) => {
    const pageRefMap: Record<string, HTMLElement | null> = {
      'player': playerPageRef.current,
      'guess-like': pageRefs.guessLikePageRef.current,
      'search': pageRefs.searchPageRef.current,
      'playlists': pageRefs.playlistsPageRef.current,
      'playlist-detail': selectedPlaylist ? pageRefs.playlistDetailPageRef.current : null,
      'history': pageRefs.historyPageRef.current,
    };
    
    const target = pageRefMap[page];
    if (!target) return;
    
    const focusFn = () => target.focus({ preventScroll: true });
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(focusFn);
    } else {
      setTimeout(focusFn, 0);
    }
  }, [pageRefs, selectedPlaylist]);

  useEffect(() => {
    focusCurrentPage(currentPage);
  }, [currentPage, focusCurrentPage]);

  const renderPlayerPage = () => (
    <div ref={playerPageRef} tabIndex={-1} style={{ height: '100%', overflow: 'hidden' }}>
      <PlayerPage
        playModeConfig={playModeConfig}
        onLyricSeek={handleLyricSeek}
      />
    </div>
  );

  const renderNonHistoryContent = () => {
    const contentMap: Record<string, React.ReactElement | null> = {
      'player': renderPlayerPage(),
      'guess-like': content.guessLikeContent,
      'search': content.searchPageContent,
      'playlists': content.playlistsContent,
      'playlist-detail': content.playlistDetailContent,
    };
    return contentMap[currentPage] ?? null;
  };

  if (!isLoggedIn) {
    return (
      <div style={{
        position: 'fixed',
        top: `${SYSTEM_TOP_BAR_HEIGHT}px`,
        left: 0,
        right: 0,
        bottom: `${SYSTEM_BOTTOM_BAR_HEIGHT}px`,
        background: '#0e1419',
        overflow: 'auto'
      }}>
        <LoginPage onLoginSuccess={handleLoginSuccess} />
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      top: `${SYSTEM_TOP_BAR_HEIGHT}px`,
      left: 0,
      right: 0,
      bottom: `${SYSTEM_BOTTOM_BAR_HEIGHT}px`,
      background: '#0e1419',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      <div style={{
        flex: 1,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        position: 'relative'
      }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'auto',
          opacity: currentPage === 'history' ? 0 : 1,
          transition: 'opacity 140ms ease-out',
          overflow: 'hidden',
        }}>
          {renderNonHistoryContent()}
        </div>
        {currentPage === 'history' && (
          <div style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'auto',
            opacity: 1,
            transition: 'opacity 140ms ease-out',
            overflow: 'hidden',
          }}>
            {content.historyContent}
          </div>
        )}
      </div>

      <NavBar currentPage={currentPage} onNavigate={navigateToPage} />
    </div>
  );
};

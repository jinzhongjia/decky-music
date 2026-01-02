/**
 * 全屏音乐播放器页面
 * 从左侧菜单进入的独立页面
 */
/* global HTMLDivElement, HTMLElement, requestAnimationFrame */

import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoginPage } from "../components";
import { getProviderSelection } from "../api";
import { setAuthLoggedIn, useAuthStatus } from "../state/authState";
import { useDataManager } from "../hooks/useDataManager";
import { useProvider } from "../hooks/useProvider";
import { useMountedRef } from "../hooks/useMountedRef";
import { usePlayer } from "../hooks/usePlayer";
import { useAutoLoadGuessLike } from "../hooks/useAutoLoadGuessLike";
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
  const {
    currentSong,
    isPlaying,
    duration,
    playMode,
    seek,
    togglePlay,
  } = player;
  const { preloadData } = dataManager;

  const isNetease = provider?.id === "netease";
  const currentPlayingMid = currentSong?.mid;

  // 播放模式配置
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

  // 歌词跳转处理
  const handleLyricSeek = useCallback((timeSec: number) => {
    if (!currentSong) return;
    const total = duration || currentSong.duration || 0;
    if (!total || !isFinite(total)) return;
    const clamped = Math.max(0, Math.min(timeSec, total));
    seek(clamped);
    if (!isPlaying) {
      togglePlay();
    }
  }, [currentSong, duration, isPlaying, seek, togglePlay]);

  // 页面导航（直接使用 setCurrentPage）
  const navigateToPage = setCurrentPage;

  // 检查登录状态
  const checkLoginStatus = useCallback(async () => {
    try {
      const result = await getProviderSelection();
      if (!mountedRef.current) return;
      const isLoggedIn = Boolean(result.success && result.mainProvider);
      setAuthLoggedIn(isLoggedIn);
    } catch (e) {
      console.error("检查登录状态失败:", e);
    }
  }, [mountedRef]);

  // 如果首次没有登录状态（初始渲染时 auth 状态未知），进行一次检查
  useEffect(() => {
    if (isLoggedIn === false || isLoggedIn === true) return;
    checkLoginStatus();
  }, [isLoggedIn, checkLoginStatus]);

  // 进入猜你喜欢页面时自动加载数据（按需加载模式）
  useAutoLoadGuessLike(currentPage === 'guess-like');

  // 手柄快捷键
  useFullscreenGamepad(player, currentPage, navigateToPage);

  // 事件处理函数
  const {
    handleSelectSong,
    handleSelectPlaylist: handleSelectPlaylistRaw,
    handleAddPlaylistToQueue,
  } = useFullscreenHandlers(player, dataManager, navigateToPage);

  // 包装 handleSelectPlaylist 以设置 selectedPlaylist
  const handleSelectPlaylist = useCallback((playlistInfo: PlaylistInfo) => {
    setSelectedPlaylist(playlistInfo);
    handleSelectPlaylistRaw(playlistInfo);
  }, [handleSelectPlaylistRaw]);

  // 登录成功处理
  const handleLoginSuccess = useCallback(() => {
    setAuthLoggedIn(true);
    navigateToPage('player');
    preloadData();
  }, [navigateToPage, preloadData]);

  // 导航辅助函数
  const goBackToPlayer = useCallback(() => navigateToPage('player'), [navigateToPage]);
  const goBackToPlaylists = useCallback(() => navigateToPage('playlists'), [navigateToPage]);

  // 页面内容
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

  // 页面焦点管理
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

  // 渲染播放器页面
  const renderPlayerPage = () => (
    <div ref={playerPageRef} tabIndex={-1}>
      <PlayerPage
        player={player}
        playModeConfig={playModeConfig}
        onLyricSeek={handleLyricSeek}
      />
    </div>
  );

  // 渲染非历史页面内容
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

  // 未登录
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
      {/* 主内容区 - 固定高度，内部滚动 */}
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

      {/* 底部导航栏 - 固定高度 */}
      <NavBar currentPage={currentPage} onNavigate={navigateToPage} />
    </div>
  );
};

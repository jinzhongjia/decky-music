/**
 * 全屏音乐播放器页面
 * 从左侧菜单进入的独立页面
 */
/* global HTMLDivElement, HTMLElement, requestAnimationFrame */

import { FC, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "@decky/ui";
import { FaListOl, FaPause, FaPlay, FaRandom, FaRedo, FaStepBackward, FaStepForward } from "react-icons/fa";

import { toaster } from "@decky/api";
import { HistoryPage, LoginPage, PlaylistDetailPage, PlaylistsPage, SearchPage } from "../components";
import { getLoginStatus } from "../api";
import { GuessLikePage } from "./fullscreen/GuessLikePage";
import { KaraokeLyrics } from "./fullscreen/KaraokeLyrics";
import { NavBar } from "./fullscreen/NavBar";
import { PlayerCover } from "./fullscreen/PlayerCover";
import { PlayerMeta } from "./fullscreen/PlayerMeta";
import { PlayerProgress } from "./fullscreen/PlayerProgress";
import { NAV_ITEMS } from "./fullscreen/navItems";
import { useDataManager } from "../hooks/useDataManager";
import { useMountedRef } from "../hooks/useMountedRef";
import { usePlayer } from "../hooks/usePlayer";
import type { SongInfo, PlaylistInfo } from "../types";
import type { FullscreenPageType } from "./fullscreen/types";

const MemoSearchPage = memo(SearchPage);
const MemoPlaylistsPage = memo(PlaylistsPage);
const MemoPlaylistDetailPage = memo(PlaylistDetailPage);
const MemoHistoryPage = memo(HistoryPage);

const SYSTEM_TOP_BAR_HEIGHT = 40;
const SYSTEM_BOTTOM_BAR_HEIGHT = 40;

export const FullscreenPlayer: FC = () => {
  const [currentPage, setCurrentPage] = useState<FullscreenPageType>('player');
  const [checking, setChecking] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistInfo | null>(null);
  const mountedRef = useMountedRef();
  const playerPageRef = useRef<HTMLDivElement>(null);
  const guessLikePageRef = useRef<HTMLDivElement>(null);
  const searchPageRef = useRef<HTMLDivElement>(null);
  const playlistsPageRef = useRef<HTMLDivElement>(null);
  const playlistDetailPageRef = useRef<HTMLDivElement>(null);
  const historyPageRef = useRef<HTMLDivElement>(null);

  const player = usePlayer();
  const dataManager = useDataManager();
  const {
    currentSong,
    isPlaying,
    currentTime,
    duration,
    loading: playerLoading,
    lyric,
    playlist,
    currentIndex,
    playSong,
    playPlaylist,
    addToQueue,
    removeFromQueue,
    playAtIndex,
    togglePlay,
    seek,
    playNext,
    playPrev,
    setOnNeedMoreSongs,
    playMode,
    cyclePlayMode,
  } = player;
  const {
    guessLikeSongs,
    guessLoading,
    refreshGuessLike,
    preloadData,
  } = dataManager;
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
    seek(clamped);
    if (!isPlaying) {
      togglePlay();
    }
  }, [currentSong, duration, isPlaying, seek, togglePlay]);
  const navigateToPage = useCallback((page: FullscreenPageType) => {
    setCurrentPage(page);
  }, []);
  const nextGuessLikeRef = useRef<SongInfo[] | null>(null);
  const nextGuessLikePromiseRef = useRef<Promise<void> | null>(null);
  
  // 保存最新状态到 ref，用于手柄快捷键
  const playerRef = useRef(player);
  const currentPageRef = useRef(currentPage);
  useEffect(() => {
    playerRef.current = player;
  });
  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  const checkLoginStatus = useCallback(async () => {
    setChecking(true);
    try {
      const result = await getLoginStatus();
      if (!mountedRef.current) return;
      setIsLoggedIn(result.logged_in);
      // 数据由 dataManager 预加载，这里不需要额外加载
    } catch (e) {
      console.error("检查登录状态失败:", e);
    }
    setChecking(false);
  }, [mountedRef]);

  // 检查登录状态
  useEffect(() => {
    checkLoginStatus();
  }, [checkLoginStatus]);

  // 手柄快捷键绑定
  useEffect(() => {
    // @ts-ignore
    // eslint-disable-next-line no-undef
    if (typeof SteamClient === 'undefined' || !SteamClient?.Input?.RegisterForControllerInputMessages) {
      return;
    }

    // @ts-ignore
    // eslint-disable-next-line no-undef
    const unregister = SteamClient.Input.RegisterForControllerInputMessages(
      (_controllerIndex: number, button: number, pressed: boolean) => {
        if (!pressed) return;
        
        const p = playerRef.current;
        const page = currentPageRef.current;

        switch (button) {
          case 2: // X - 播放/暂停
            if (p.currentSong) p.togglePlay();
            break;
          case 30: // L1 - 上一曲
            if (p.playlist.length > 1) p.playPrev();
            break;
          case 31: // R1 - 下一曲
            if (p.playlist.length > 1) p.playNext();
            break;
          case 28: // LT - 底部导航左切换
          case 29: { // RT - 底部导航右切换
            const activeId = page === 'playlist-detail' ? 'playlists' : page;
            const currentIndex = NAV_ITEMS.findIndex((item) => item.id === activeId);
            if (currentIndex === -1) break;
            const delta = button === 28 ? -1 : 1;
            const nextIndex =
              (currentIndex + delta + NAV_ITEMS.length) % NAV_ITEMS.length;
            navigateToPage(NAV_ITEMS[nextIndex].id as FullscreenPageType);
            break;
          }
        }
      }
    );

    return () => {
      unregister?.unregister?.();
    };
  }, [navigateToPage]);

  const handleLoginSuccess = useCallback(() => {
    setIsLoggedIn(true);
    navigateToPage('player');
    preloadData();
  }, [navigateToPage, preloadData]);

  // 获取更多猜你喜欢歌曲的回调
  const prefetchNextGuessLikeBatch = useCallback(() => {
    if (nextGuessLikePromiseRef.current) return;
    nextGuessLikePromiseRef.current = refreshGuessLike()
      .then((songs) => {
        nextGuessLikeRef.current = songs;
      })
      .catch(() => { })
      .finally(() => {
        nextGuessLikePromiseRef.current = null;
      });
  }, [refreshGuessLike]);

  const fetchMoreGuessLikeSongs = useCallback(async (): Promise<SongInfo[]> => {
    if (nextGuessLikeRef.current && nextGuessLikeRef.current.length > 0) {
      const cached = nextGuessLikeRef.current;
      nextGuessLikeRef.current = null;
      prefetchNextGuessLikeBatch();
      return cached;
    }
    const songs = await refreshGuessLike();
    prefetchNextGuessLikeBatch();
    return songs;
  }, [prefetchNextGuessLikeBatch, refreshGuessLike]);

  // 选择歌曲
  const handleSelectSong = useCallback(async (song: SongInfo, songList?: SongInfo[], source?: string) => {
    if (songList && songList.length > 0) {
      const index = songList.findIndex(s => s.mid === song.mid);
      await playPlaylist(songList, index >= 0 ? index : 0);
      
      if (source === 'guess-like') {
        setOnNeedMoreSongs(fetchMoreGuessLikeSongs);
      } else {
        setOnNeedMoreSongs(null);
      }
    } else {
      await playSong(song);
      setOnNeedMoreSongs(null);
    }
    navigateToPage('player');
  }, [fetchMoreGuessLikeSongs, navigateToPage, playPlaylist, playSong, setOnNeedMoreSongs]);

  const handleSelectPlaylist = useCallback((playlistInfo: PlaylistInfo) => {
    setSelectedPlaylist(playlistInfo);
    navigateToPage('playlist-detail');
  }, [navigateToPage]);

  const handleAddPlaylistToQueue = useCallback(async (songs: SongInfo[]) => {
    if (!songs || songs.length === 0) return;
    await addToQueue(songs);
    toaster.toast({
      title: "已添加到播放队列",
      body: `加入 ${songs.length} 首歌曲`,
    });
  }, [addToQueue]);

  const goBackToPlayer = useCallback(() => navigateToPage('player'), [navigateToPage]);
  const goBackToPlaylists = useCallback(() => navigateToPage('playlists'), [navigateToPage]);

  const handleRefreshGuessLike = useCallback(() => refreshGuessLike(), [refreshGuessLike]);

  const guessLikeContent = useMemo(() => (
    <div ref={guessLikePageRef} tabIndex={-1} style={{ height: '100%' }}>
      <GuessLikePage
        songs={guessLikeSongs}
        loading={guessLoading}
        onRefresh={handleRefreshGuessLike}
        onSelectSong={(song) => handleSelectSong(song, guessLikeSongs, 'guess-like')}
      />
    </div>
  ), [guessLikeSongs, guessLoading, handleRefreshGuessLike, handleSelectSong]);

  const searchPageContent = useMemo(() => (
    <div ref={searchPageRef} tabIndex={-1} style={{ height: '100%', overflow: 'auto' }}>
      <MemoSearchPage
        onSelectSong={handleSelectSong}
        onBack={goBackToPlayer}
        currentPlayingMid={currentPlayingMid}
      />
    </div>
  ), [currentPlayingMid, goBackToPlayer, handleSelectSong]);

  const playlistsContent = useMemo(() => (
    <div ref={playlistsPageRef} tabIndex={-1} style={{ height: '100%', overflow: 'auto' }}>
      <MemoPlaylistsPage
        onSelectPlaylist={handleSelectPlaylist}
        onBack={goBackToPlayer}
      />
    </div>
  ), [goBackToPlayer, handleSelectPlaylist]);

  const playlistDetailContent = useMemo(() => {
    if (!selectedPlaylist) return null;
    return (
      <div ref={playlistDetailPageRef} tabIndex={-1} style={{ height: '100%', overflow: 'auto' }}>
        <MemoPlaylistDetailPage
          playlist={selectedPlaylist}
          onSelectSong={handleSelectSong}
          onAddPlaylistToQueue={handleAddPlaylistToQueue}
          onBack={goBackToPlaylists}
          currentPlayingMid={currentPlayingMid}
        />
      </div>
    );
  }, [currentPlayingMid, goBackToPlaylists, handleAddPlaylistToQueue, handleSelectSong, selectedPlaylist]);

  const historyContent = useMemo(() => (
    <div ref={historyPageRef} tabIndex={-1} style={{ height: '100%', overflow: 'auto' }}>
      <MemoHistoryPage
        playlist={playlist}
        currentIndex={currentIndex}
        onSelectIndex={playAtIndex}
        onBack={goBackToPlayer}
        currentPlayingMid={currentPlayingMid}
        onRemoveFromQueue={removeFromQueue}
      />
    </div>
  ), [currentIndex, currentPlayingMid, goBackToPlayer, playAtIndex, playlist, removeFromQueue]);

  const focusCurrentPage = useCallback((page: FullscreenPageType) => {
    let target: HTMLElement | null = null;
    switch (page) {
      case 'player':
        target = playerPageRef.current;
        break;
      case 'guess-like':
        target = guessLikePageRef.current;
        break;
      case 'search':
        target = searchPageRef.current;
        break;
      case 'playlists':
        target = playlistsPageRef.current;
        break;
      case 'playlist-detail':
        target = selectedPlaylist ? playlistDetailPageRef.current : null;
        break;
      case 'history':
        target = historyPageRef.current;
        break;
      default:
        break;
    }
    if (!target) return;
    const focusFn = () => target?.focus({ preventScroll: true });
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(focusFn);
    } else {
      setTimeout(focusFn, 0);
    }
  }, [selectedPlaylist]);

  useEffect(() => {
    focusCurrentPage(currentPage);
  }, [currentPage, focusCurrentPage]);

  // 加载中
  if (checking) {
    return (
      <div style={{ 
        position: 'fixed',
        top: `${SYSTEM_TOP_BAR_HEIGHT}px`,
        left: 0,
        right: 0,
        bottom: `${SYSTEM_BOTTOM_BAR_HEIGHT}px`,
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: '#0e1419'
      }}>
        <Spinner />
      </div>
    );
  }

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

  // 渲染播放详细页（带歌词）
  const renderPlayerPage = () => {
    const song = currentSong;

    return (
      <div
        ref={playerPageRef}
        tabIndex={-1}
        style={{ 
        display: 'flex', 
        height: '100%',
        padding: '16px 24px',
        gap: '20px',
        boxSizing: 'border-box'
      }}>
        {/* 左侧：封面和控制 */}
        <div style={{ 
          width: '320px',
          flexShrink: 0,
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <PlayerCover song={song} />

          <PlayerMeta song={song} />

          <PlayerProgress
            hasSong={!!song}
            currentTime={currentTime}
            duration={duration || song?.duration || 0}
            onSeek={seek}
          />

          {/* 控制按钮 */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '16px',
            marginBottom: '8px'
          }}>
            <div
              onClick={cyclePlayMode}
              title={playModeConfig.title}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
            >
              {playModeConfig.icon}
            </div>

            <div
              onClick={() => playlist.length > 1 && playPrev()}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: playlist.length > 1 ? 'pointer' : 'not-allowed',
                opacity: playlist.length > 1 ? 1 : 0.4
              }}
            >
              <FaStepBackward size={14} />
            </div>

            <div
              onClick={() => song && togglePlay()}
              style={{
                width: '50px',
                height: '50px',
                borderRadius: '50%',
                background: song ? '#1db954' : 'rgba(255,255,255,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: song ? 'pointer' : 'not-allowed',
                boxShadow: song ? '0 2px 12px rgba(29, 185, 84, 0.4)' : 'none'
              }}
            >
              {playerLoading ? (
                <Spinner style={{ width: '20px', height: '20px' }} />
              ) : isPlaying ? (
                <FaPause size={18} />
              ) : (
                <FaPlay size={18} style={{ marginLeft: '2px' }} />
              )}
            </div>

            <div
              onClick={() => playlist.length > 1 && playNext()}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: playlist.length > 1 ? 'pointer' : 'not-allowed',
                opacity: playlist.length > 1 ? 1 : 0.4
              }}
            >
              <FaStepForward size={14} />
            </div>
          </div>

          {/* 快捷键提示 */}
          <div style={{
            fontSize: '10px',
            color: '#555',
            display: 'flex',
            gap: '10px'
          }}>
            <span>L1 上一首</span>
            <span>X 暂停</span>
            <span>R1 下一首</span>
          </div>
        </div>

        {/* 右侧：Spotify 风格歌词区域 */}
        <div style={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0,
          background: 'linear-gradient(180deg, rgba(0,0,0,0.2) 0%, transparent 100%)',
          borderRadius: '12px',
        }}>
          {/* 使用独立的歌词组件 - 高频刷新隔离在这里 */}
          <KaraokeLyrics 
            lyric={lyric} 
            isPlaying={isPlaying} 
            hasSong={!!song} 
            onSeek={handleLyricSeek}
          />
        </div>
      </div>
    );
  };

  const renderNonHistoryContent = () => {
    switch (currentPage) {
      case 'player':
        return renderPlayerPage();
      case 'guess-like':
        return guessLikeContent;
      case 'search':
        return searchPageContent;
      case 'playlists':
        return playlistsContent;
      case 'playlist-detail':
        return playlistDetailContent;
      default:
        return null;
    }
  };

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
            {historyContent}
          </div>
        )}
      </div>

      {/* 底部导航栏 - 固定高度 */}
      <NavBar currentPage={currentPage} onNavigate={navigateToPage} />
    </div>
  );
};

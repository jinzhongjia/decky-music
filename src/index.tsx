/**
 * Decky QQ Music 插件主入口
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { PanelSection, PanelSectionRow, staticClasses, Spinner } from "@decky/ui";
import { definePlugin, toaster, routerHook } from "@decky/api";
import { FaMusic } from "react-icons/fa";

import { getLoginStatus, logout } from "./api";
import { preloadData, clearDataCache, refreshGuessLike } from "./hooks/useDataManager";
import { usePlayer, cleanupPlayer } from "./hooks/usePlayer";
import { useMountedRef } from "./hooks/useMountedRef";
import { LoginPage, HomePage, SearchPage, PlayerPage, PlayerBar, PlaylistsPage, PlaylistDetailPage, HistoryPage, clearRecommendCache } from "./components";
import { FullscreenPlayer } from "./pages";
import { ROUTE_PATH, menuManager } from "./patches";
import type { PageType, SongInfo, PlaylistInfo } from "./types";

// 主内容组件
function Content() {
  const [currentPage, setCurrentPage] = useState<PageType>('login');
  const [checking, setChecking] = useState(true);
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistInfo | null>(null);
  const mountedRef = useMountedRef();
  
  const player = usePlayer();
  
  // 使用 ref 保存最新的 player 和页面状态，避免闭包问题
  const playerRef = useRef(player);
  const currentPageRef = useRef(currentPage);
  const nextGuessLikeRef = useRef<SongInfo[] | null>(null);
  const nextGuessLikePromiseRef = useRef<Promise<void> | null>(null);
  
  // 每次渲染时更新 ref
  useEffect(() => {
    playerRef.current = player;
    currentPageRef.current = currentPage;
  }, [player, currentPage]);

  const checkLoginStatus = useCallback(async () => {
    setChecking(true);
    try {
      const result = await getLoginStatus();
      if (!mountedRef.current) return;
      setCurrentPage(result.logged_in ? 'home' : 'login');
      
      // 已登录时启用左侧菜单
      if (result.logged_in) {
        menuManager.enable();
      }
    } catch (e) {
      console.error("检查登录状态失败:", e);
      if (!mountedRef.current) return;
      setCurrentPage('login');
    }
    setChecking(false);
  }, [mountedRef]);

  useEffect(() => {
    checkLoginStatus();
  }, [checkLoginStatus]);

  // 手柄快捷键绑定
  // X (2): 暂停/播放
  // L1 (30): 上一曲
  // R1 (31): 下一曲  
  // Y (3): 进入详细页
  useEffect(() => {
    // @ts-ignore - SteamClient 是全局变量
    // eslint-disable-next-line no-undef
    if (typeof SteamClient === 'undefined' || !SteamClient?.Input?.RegisterForControllerInputMessages) {
      console.warn("SteamClient.Input 不可用，跳过手柄快捷键绑定");
      return;
    }

    // @ts-ignore
    // eslint-disable-next-line no-undef
    const unregister = SteamClient.Input.RegisterForControllerInputMessages(
      (_controllerIndex: number, button: number, pressed: boolean) => {
        // 只处理按下事件
        if (!pressed) return;
        
        // 从 ref 获取最新状态
        const p = playerRef.current;
        const page = currentPageRef.current;
        
        // 只在有歌曲时响应
        if (!p.currentSong) return;

        switch (button) {
          case 2: // X - 播放/暂停
            p.togglePlay();
            break;
          case 30: // L1 - 上一曲
            if (p.playlist.length > 1) {
              p.playPrev();
            }
            break;
          case 31: // R1 - 下一曲
            if (p.playlist.length > 1) {
              p.playNext();
            }
            break;
          case 3: // Y - 进入详细页
            if (page !== 'player' && page !== 'login') {
              setCurrentPage('player');
            }
            break;
        }
      }
    );

    return () => {
      unregister?.unregister?.();
    };
  }, []); // 只注册一次，通过 ref 访问最新状态

  const handleLoginSuccess = useCallback(() => {
    setCurrentPage('home');
    // 登录成功后启用左侧菜单并预加载数据
    menuManager.enable();
    preloadData();
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    player.stop();
    clearRecommendCache(); // 清除推荐缓存（旧版兼容）
    clearDataCache(); // 清除数据管理器缓存
    // 退出登录后禁用左侧菜单
    menuManager.disable();
    setCurrentPage('login');
    toaster.toast({
      title: "已退出登录",
      body: "期待下次见面！"
    });
  }, [player]);

  // 获取更多猜你喜欢歌曲的回调
  const fetchMoreGuessLikeSongs = async (): Promise<SongInfo[]> => {
    if (nextGuessLikeRef.current && nextGuessLikeRef.current.length > 0) {
      const cached = nextGuessLikeRef.current;
      nextGuessLikeRef.current = null;
      // 继续预拉取下一批
      prefetchNextGuessLikeBatch();
      return cached;
    }

    const songs = await refreshGuessLike();
    // 拉取后立即预取下一批，保持连续
    prefetchNextGuessLikeBatch();
    return songs;
  };

  // 预取下一批猜你喜欢
  const prefetchNextGuessLikeBatch = () => {
    if (nextGuessLikePromiseRef.current) return;
    nextGuessLikePromiseRef.current = refreshGuessLike()
      .then((songs) => {
        nextGuessLikeRef.current = songs;
      })
      .catch(() => { })
      .finally(() => {
        nextGuessLikePromiseRef.current = null;
      });
  };

  // 从列表中选择歌曲时，设置整个列表为播放列表
  // source: 'guess-like' 表示来自猜你喜欢，播放完后会自动刷新
  const handleSelectSong = useCallback(async (song: SongInfo, playlist?: SongInfo[], source?: string) => {
    if (playlist && playlist.length > 0) {
      const index = playlist.findIndex(s => s.mid === song.mid);
      await player.playPlaylist(playlist, index >= 0 ? index : 0);
      
      // 如果是猜你喜欢，设置自动刷新回调
      if (source === 'guess-like') {
        player.setOnNeedMoreSongs(fetchMoreGuessLikeSongs);
      } else {
        player.setOnNeedMoreSongs(null);
      }
    } else {
      await player.playSong(song);
      player.setOnNeedMoreSongs(null);
    }
  }, [player]);

  const handleGoToPlayer = useCallback(() => {
    if (player.currentSong) {
      setCurrentPage('player');
    }
  }, [player.currentSong]);

  const handleGoToSearch = useCallback(() => {
    setCurrentPage('search');
  }, []);

  const handleGoToPlaylists = useCallback(() => {
    setCurrentPage('playlists');
  }, []);

  const handleGoToHistory = useCallback(() => {
    setCurrentPage('history');
  }, []);

  const handleBackToHome = useCallback(() => {
    setCurrentPage('home');
  }, []);

  const handleBackToPlaylists = useCallback(() => {
    setCurrentPage('playlists');
  }, []);

  // 选择歌单
  const handleSelectPlaylist = useCallback((playlist: PlaylistInfo) => {
    setSelectedPlaylist(playlist);
    setCurrentPage('playlist-detail');
  }, []);

  const handleAddSongToQueue = useCallback(async (song: SongInfo) => {
    await player.addToQueue([song]);
    toaster.toast({
      title: "已添加到播放队列",
      body: song.name
    });
  }, [player]);

  const handleAddPlaylistToQueue = useCallback(async (songs: SongInfo[]) => {
    if (!songs || songs.length === 0) return;
    await player.addToQueue(songs);
    toaster.toast({
      title: "已添加到播放队列",
      body: `加入 ${songs.length} 首歌曲`
    });
  }, [player]);

  // 加载中
  if (checking) {
    return (
      <PanelSection title="QQ音乐">
        <PanelSectionRow>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
            <Spinner />
          </div>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  // 渲染页面
  const renderPage = () => {
    switch (currentPage) {
      case 'login':
        return <LoginPage onLoginSuccess={handleLoginSuccess} />;
      
      case 'home':
        return (
          <HomePage
            onSelectSong={handleSelectSong}
            onGoToSearch={handleGoToSearch}
            onGoToPlaylists={handleGoToPlaylists}
            onGoToHistory={handleGoToHistory}
            onLogout={handleLogout}
            currentPlayingMid={player.currentSong?.mid}
            onAddSongToQueue={handleAddSongToQueue}
          />
        );
      
      case 'search':
        return (
          <SearchPage
            onSelectSong={handleSelectSong}
            onBack={handleBackToHome}
            currentPlayingMid={player.currentSong?.mid}
            onAddSongToQueue={handleAddSongToQueue}
          />
        );
      
      case 'playlists':
        return (
          <PlaylistsPage
            onSelectPlaylist={handleSelectPlaylist}
            onBack={handleBackToHome}
          />
        );
      
      case 'playlist-detail':
        return selectedPlaylist ? (
          <PlaylistDetailPage
            playlist={selectedPlaylist}
            onSelectSong={handleSelectSong}
            onAddPlaylistToQueue={handleAddPlaylistToQueue}
            onAddSongToQueue={handleAddSongToQueue}
            onBack={handleBackToPlaylists}
            currentPlayingMid={player.currentSong?.mid}
          />
        ) : (
          <PlaylistsPage
            onSelectPlaylist={handleSelectPlaylist}
            onBack={handleBackToHome}
          />
        );

      case 'history':
        return (
          <HistoryPage
            playlist={player.playlist}
            currentIndex={player.currentIndex}
            onSelectIndex={player.playAtIndex}
            onBack={handleBackToHome}
            currentPlayingMid={player.currentSong?.mid}
            onRemoveFromQueue={player.removeFromQueue}
            onRemoveHistory={player.removeFromQueue} // 复用删除逻辑
          />
        );

      case 'history':
        return (
          <HistoryPage
            playlist={player.playlist}
            currentIndex={player.currentIndex}
            onSelectIndex={player.playAtIndex}
            onBack={handleBackToHome}
            currentPlayingMid={player.currentSong?.mid}
            onRemoveFromQueue={player.removeFromQueue}
          />
        );
      
      case 'player':
        return player.currentSong ? (
          <PlayerPage
            song={player.currentSong}
            isPlaying={player.isPlaying}
            currentTime={player.currentTime}
            duration={player.duration}
            loading={player.loading}
            error={player.error}
            hasPlaylist={player.playlist.length > 1}
            onTogglePlay={player.togglePlay}
            onSeek={player.seek}
            onNext={player.playNext}
            onPrev={player.playPrev}
            onBack={handleBackToHome}
          />
        ) : (
          <HomePage
            onSelectSong={handleSelectSong}
            onGoToSearch={handleGoToSearch}
            onGoToPlaylists={handleGoToPlaylists}
            onGoToHistory={handleGoToHistory}
            onLogout={handleLogout}
            onAddSongToQueue={handleAddSongToQueue}
          />
        );
      
      default:
        return <LoginPage onLoginSuccess={handleLoginSuccess} />;
    }
  };

  return (
    <div className="qqmusic-container" style={{ paddingBottom: player.currentSong && currentPage !== 'player' ? '70px' : '0' }}>
      {renderPage()}
      
      {/* 迷你播放器条 - 非全屏播放器页面且有歌曲时显示 */}
      {player.currentSong && currentPage !== 'player' && currentPage !== 'login' && (
        <PlayerBar
          song={player.currentSong}
          isPlaying={player.isPlaying}
          currentTime={player.currentTime}
          duration={player.duration || player.currentSong.duration}
          loading={player.loading}
          onTogglePlay={player.togglePlay}
          onSeek={player.seek}
          onClick={handleGoToPlayer}
          onNext={player.playlist.length > 1 ? player.playNext : undefined}
          onPrev={player.playlist.length > 1 ? player.playPrev : undefined}
        />
      )}
    </div>
  );
}

// 插件导出
export default definePlugin(() => {
  console.log("Decky QQ Music 插件已初始化");

  // 添加全局样式
  const style = document.createElement('style');
  style.id = 'decky-qqmusic-styles';
  style.textContent = `
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    
    /* 防止滚动条导致宽度变化 */
    .qqmusic-container {
      overflow-x: hidden;
      box-sizing: border-box;
    }
    
    /* 控制按钮焦点高亮（使用 focusClassName） */
    .qqmusic-control-btn-focused {
      outline: 2px solid rgba(255, 255, 255, 0.9) !important;
      outline-offset: 3px;
      background: rgba(255, 255, 255, 0.2) !important;
    }
    
    /* 播放/暂停按钮焦点高亮 */
    .qqmusic-play-btn-focused {
      outline: 3px solid #fff !important;
      outline-offset: 4px;
      box-shadow: 0 4px 28px rgba(29, 185, 84, 0.8) !important;
    }
  `;
  document.head.appendChild(style);

  // 注册全屏路由
  routerHook.addRoute(ROUTE_PATH, FullscreenPlayer);
  console.log(`[QQMusic] 路由已注册: ${ROUTE_PATH}`);

  // 插件初始化时检查登录状态，已登录则启用左侧菜单并预加载数据
  getLoginStatus().then(result => {
    if (result.logged_in) {
      console.log("[QQMusic] 用户已登录，启用左侧菜单并预加载数据");
      menuManager.enable();
      // 预加载数据
      preloadData();
    } else {
      console.log("[QQMusic] 用户未登录，不启用左侧菜单");
    }
  }).catch(e => {
    console.error("[QQMusic] 检查登录状态失败:", e);
  });

  return {
    name: "QQ音乐",
    titleView: (
      <div className={staticClasses.Title}>
        <FaMusic style={{ marginRight: '8px' }} />
        QQ音乐
      </div>
    ),
    content: <Content />,
    icon: <FaMusic />,
    onDismount() {
      console.log("Decky QQ Music 插件已卸载");
      
      // 清理菜单 patch
      menuManager.cleanup();
      
      // 移除路由
      routerHook.removeRoute(ROUTE_PATH);
      
      // 清理播放器（停止播放、恢复休眠）
      cleanupPlayer();
      
      // 移除全局样式
      const styleEl = document.getElementById('decky-qqmusic-styles');
      if (styleEl) {
        styleEl.remove();
      }
    },
  };
});

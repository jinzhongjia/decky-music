/**
 * Decky QQ Music 插件主入口
 */

import { useState, useEffect, useRef } from "react";
import { PanelSection, PanelSectionRow, staticClasses, Spinner } from "@decky/ui";
import { definePlugin, toaster } from "@decky/api";
import { FaMusic } from "react-icons/fa";

import { getLoginStatus, logout, getGuessLike } from "./api";
import { usePlayer } from "./hooks/usePlayer";
import { LoginPage, HomePage, SearchPage, PlayerPage, PlayerBar, PlaylistsPage, PlaylistDetailPage, HistoryPage } from "./components";
import type { PageType, SongInfo, PlaylistInfo } from "./types";

// 主内容组件
function Content() {
  const [currentPage, setCurrentPage] = useState<PageType>('login');
  const [checking, setChecking] = useState(true);
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistInfo | null>(null);
  const mountedRef = useRef(true);
  
  const player = usePlayer();

  useEffect(() => {
    mountedRef.current = true;
    checkLoginStatus();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const checkLoginStatus = async () => {
    setChecking(true);
    try {
      const result = await getLoginStatus();
      if (!mountedRef.current) return;
      setCurrentPage(result.logged_in ? 'home' : 'login');
    } catch (e) {
      console.error("检查登录状态失败:", e);
      if (!mountedRef.current) return;
      setCurrentPage('login');
    }
    setChecking(false);
  };

  const handleLoginSuccess = () => {
    setCurrentPage('home');
  };

  const handleLogout = async () => {
    await logout();
    player.stop();
    setCurrentPage('login');
    toaster.toast({
      title: "已退出登录",
      body: "期待下次见面！"
    });
  };

  // 获取更多猜你喜欢歌曲的回调
  const fetchMoreGuessLikeSongs = async (): Promise<SongInfo[]> => {
    const result = await getGuessLike();
    if (result.success && result.songs.length > 0) {
      return result.songs;
    }
    return [];
  };

  // 从列表中选择歌曲时，设置整个列表为播放列表
  // source: 'guess-like' 表示来自猜你喜欢，播放完后会自动刷新
  const handleSelectSong = async (song: SongInfo, playlist?: SongInfo[], source?: string) => {
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
  };

  const handleGoToPlayer = () => {
    if (player.currentSong) {
      setCurrentPage('player');
    }
  };

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

  // 选择歌单
  const handleSelectPlaylist = (playlist: PlaylistInfo) => {
    setSelectedPlaylist(playlist);
    setCurrentPage('playlist-detail');
  };

  // 渲染页面
  const renderPage = () => {
    switch (currentPage) {
      case 'login':
        return <LoginPage onLoginSuccess={handleLoginSuccess} />;
      
      case 'home':
        return (
          <HomePage
            onSelectSong={handleSelectSong}
            onGoToSearch={() => setCurrentPage('search')}
            onGoToPlaylists={() => setCurrentPage('playlists')}
            onGoToHistory={() => setCurrentPage('history')}
            onLogout={handleLogout}
            currentPlayingMid={player.currentSong?.mid}
          />
        );
      
      case 'history':
        return (
          <HistoryPage
            history={player.playHistory}
            onSelectSong={handleSelectSong}
            onClearHistory={player.clearPlayHistory}
            onRefreshHistory={player.refreshPlayHistory}
            onBack={() => setCurrentPage('home')}
            currentPlayingMid={player.currentSong?.mid}
          />
        );
      
      case 'search':
        return (
          <SearchPage
            onSelectSong={handleSelectSong}
            onBack={() => setCurrentPage('home')}
            currentPlayingMid={player.currentSong?.mid}
          />
        );
      
      case 'playlists':
        return (
          <PlaylistsPage
            onSelectPlaylist={handleSelectPlaylist}
            onBack={() => setCurrentPage('home')}
          />
        );
      
      case 'playlist-detail':
        return selectedPlaylist ? (
          <PlaylistDetailPage
            playlist={selectedPlaylist}
            onSelectSong={handleSelectSong}
            onBack={() => setCurrentPage('playlists')}
            currentPlayingMid={player.currentSong?.mid}
          />
        ) : (
          <PlaylistsPage
            onSelectPlaylist={handleSelectPlaylist}
            onBack={() => setCurrentPage('home')}
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
            onBack={() => setCurrentPage('home')}
          />
        ) : (
          <HomePage
            onSelectSong={handleSelectSong}
            onGoToSearch={() => setCurrentPage('search')}
            onGoToPlaylists={() => setCurrentPage('playlists')}
            onGoToHistory={() => setCurrentPage('history')}
            onLogout={handleLogout}
          />
        );
      
      default:
        return <LoginPage onLoginSuccess={handleLoginSuccess} />;
    }
  };

  return (
    <div style={{ paddingBottom: player.currentSong && currentPage !== 'player' ? '70px' : '0' }}>
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
        />
      )}
    </div>
  );
}

// 插件导出
export default definePlugin(() => {
  console.log("Decky QQ Music 插件已初始化");

  // 添加旋转动画样式
  const style = document.createElement('style');
  style.id = 'decky-qqmusic-styles';
  style.textContent = `
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);

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
      const styleEl = document.getElementById('decky-qqmusic-styles');
      if (styleEl) {
        styleEl.remove();
      }
    },
  };
});

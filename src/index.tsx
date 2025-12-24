/**
 * Decky QQ Music 插件主入口
 */

import { useState, useEffect, useRef } from "react";
import { PanelSection, PanelSectionRow, staticClasses, Spinner } from "@decky/ui";
import { definePlugin, toaster } from "@decky/api";
import { FaMusic } from "react-icons/fa";

import { getLoginStatus, logout } from "./api";
import { usePlayer } from "./hooks/usePlayer";
import { LoginPage, HomePage, SearchPage, PlayerPage, PlayerBar } from "./components";
import type { PageType, SongInfo } from "./types";

// 主内容组件
function Content() {
  const [currentPage, setCurrentPage] = useState<PageType>('login');
  const [checking, setChecking] = useState(true);
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

  const handleSelectSong = async (song: SongInfo) => {
    await player.playSong(song);
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
            onLogout={handleLogout}
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
      
      case 'player':
        return player.currentSong ? (
          <PlayerPage
            song={player.currentSong}
            isPlaying={player.isPlaying}
            currentTime={player.currentTime}
            duration={player.duration}
            loading={player.loading}
            error={player.error}
            onTogglePlay={player.togglePlay}
            onSeek={player.seek}
            onBack={() => setCurrentPage('home')}
          />
        ) : (
          <HomePage
            onSelectSong={handleSelectSong}
            onGoToSearch={() => setCurrentPage('search')}
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

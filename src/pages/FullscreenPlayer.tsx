/**
 * 全屏音乐播放器页面
 * 从左侧菜单进入的独立页面
 */

import { FC, useState, useEffect, useRef, useCallback } from "react";
import { Focusable, ButtonItem, Spinner } from "@decky/ui";
import { 
  FaPlay, FaPause, FaStepForward, FaStepBackward, FaMusic, 
  FaSearch, FaList, FaHistory, FaHeart, FaCompactDisc
} from "react-icons/fa";

import { getLoginStatus } from "../api";
import { usePlayer } from "../hooks/usePlayer";
import { useDataManager } from "../hooks/useDataManager";
import { SongItem } from "../components/SongItem";
import { LoginPage, SearchPage, PlaylistsPage, PlaylistDetailPage, HistoryPage } from "../components";
import type { SongInfo, PlaylistInfo } from "../types";

// 全屏页面内的子页面类型
type FullscreenPageType = 'player' | 'guess-like' | 'playlists' | 'playlist-detail' | 'history' | 'search' | 'queue' | 'login';

// 底部导航项
const NAV_ITEMS = [
  { id: 'player', label: '播放', icon: FaCompactDisc },
  { id: 'guess-like', label: '推荐', icon: FaHeart },
  { id: 'playlists', label: '歌单', icon: FaList },
  { id: 'history', label: '历史', icon: FaHistory },
  { id: 'search', label: '搜索', icon: FaSearch },
  { id: 'queue', label: '队列', icon: FaMusic },
] as const;

// Steam Deck 系统顶栏高度
const SYSTEM_TOP_BAR_HEIGHT = 40;
// Steam Deck 系统底栏高度（A确认/B返回等提示）
const SYSTEM_BOTTOM_BAR_HEIGHT = 40;
// 底部导航栏高度
const NAV_BAR_HEIGHT = 56;

export const FullscreenPlayer: FC = () => {
  const [currentPage, setCurrentPage] = useState<FullscreenPageType>('player');
  const [checking, setChecking] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistInfo | null>(null);
  const mountedRef = useRef(true);

  const player = usePlayer();
  const dataManager = useDataManager();
  
  // 保存最新状态到 ref，用于手柄快捷键
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  });

  // 检查登录状态
  useEffect(() => {
    mountedRef.current = true;
    checkLoginStatus();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 手柄快捷键绑定
  useEffect(() => {
    // @ts-ignore
    if (typeof SteamClient === 'undefined' || !SteamClient?.Input?.RegisterForControllerInputMessages) {
      return;
    }

    // @ts-ignore
    const unregister = SteamClient.Input.RegisterForControllerInputMessages(
      (_controllerIndex: number, button: number, pressed: boolean) => {
        if (!pressed) return;
        
        const p = playerRef.current;
        if (!p.currentSong) return;

        switch (button) {
          case 2: // X - 播放/暂停
            p.togglePlay();
            break;
          case 30: // L1 - 上一曲
            if (p.playlist.length > 1) p.playPrev();
            break;
          case 31: // R1 - 下一曲
            if (p.playlist.length > 1) p.playNext();
            break;
        }
      }
    );

    return () => {
      unregister?.unregister?.();
    };
  }, []);

  const checkLoginStatus = async () => {
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
  };

  const handleLoginSuccess = () => {
    setIsLoggedIn(true);
    setCurrentPage('player');
    // 预加载数据
    dataManager.preloadData();
  };

  // 获取更多猜你喜欢歌曲的回调
  const fetchMoreGuessLikeSongs = async (): Promise<SongInfo[]> => {
    const songs = await dataManager.refreshGuessLike();
    return songs;
  };

  // 选择歌曲
  const handleSelectSong = async (song: SongInfo, playlist?: SongInfo[], source?: string) => {
    if (playlist && playlist.length > 0) {
      const index = playlist.findIndex(s => s.mid === song.mid);
      await player.playPlaylist(playlist, index >= 0 ? index : 0);
      
      if (source === 'guess-like') {
        player.setOnNeedMoreSongs(fetchMoreGuessLikeSongs);
      } else {
        player.setOnNeedMoreSongs(null);
      }
    } else {
      await player.playSong(song);
      player.setOnNeedMoreSongs(null);
    }
    // 播放后跳转到播放页
    setCurrentPage('player');
  };

  const handleSelectPlaylist = (playlist: PlaylistInfo) => {
    setSelectedPlaylist(playlist);
    setCurrentPage('playlist-detail');
  };

  // 格式化时间
  const formatTime = (seconds: number): string => {
    if (!seconds || !isFinite(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 歌词容器引用（用于自动滚动）
  const lyricContainerRef = useRef<HTMLDivElement>(null);
  const currentLyricRef = useRef<HTMLDivElement>(null);

  // 计算当前歌词索引
  const getCurrentLyricIndex = useCallback(() => {
    const lyricLines = player.lyric?.lines || [];
    if (lyricLines.length === 0) return -1;
    
    const currentTimeMs = player.currentTime * 1000;
    
    // 找到最后一个时间小于等于当前时间的歌词
    for (let i = lyricLines.length - 1; i >= 0; i--) {
      if (lyricLines[i].time <= currentTimeMs) {
        return i;
      }
    }
    return -1;
  }, [player.lyric, player.currentTime]);

  const currentLyricIndex = getCurrentLyricIndex();

  // 自动滚动到当前歌词
  useEffect(() => {
    if (currentLyricRef.current && lyricContainerRef.current) {
      const container = lyricContainerRef.current;
      const current = currentLyricRef.current;
      
      // 计算需要滚动的位置（让当前歌词在容器中央）
      const containerHeight = container.clientHeight;
      const currentTop = current.offsetTop;
      const currentHeight = current.clientHeight;
      
      const targetScroll = currentTop - containerHeight / 2 + currentHeight / 2;
      
      container.scrollTo({
        top: Math.max(0, targetScroll),
        behavior: 'smooth'
      });
    }
  }, [currentLyricIndex]);

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
    const song = player.currentSong;
    const lyricLines = player.lyric?.lines || [];

    return (
      <div style={{ 
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
          {/* 封面 */}
          <div style={{
            width: '180px',
            height: '180px',
            borderRadius: '8px',
            overflow: 'hidden',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            marginBottom: '16px',
            flexShrink: 0
          }}>
            {song?.cover ? (
              <img 
                src={song.cover} 
                alt="封面"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <div style={{
                width: '100%',
                height: '100%',
                background: 'linear-gradient(135deg, #1db954 0%, #191414 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <FaMusic size={50} color="rgba(255,255,255,0.3)" />
              </div>
            )}
          </div>

          {/* 歌曲信息 */}
          <div style={{ textAlign: 'center', marginBottom: '12px', width: '100%' }}>
            <div style={{ 
              fontSize: '16px', 
              fontWeight: 'bold',
              marginBottom: '4px',
              color: '#fff',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {song?.name || '未播放'}
            </div>
            <div style={{ 
              fontSize: '13px', 
              color: '#8b929a',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {song?.singer || '选择一首歌曲'}
            </div>
          </div>

          {/* 进度条 */}
          {song && (
            <div style={{ width: '100%', maxWidth: '240px', marginBottom: '12px' }}>
              <div style={{
                width: '100%',
                height: '3px',
                background: 'rgba(255,255,255,0.1)',
                borderRadius: '2px',
                overflow: 'hidden',
                cursor: 'pointer'
              }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                const newTime = percent * (player.duration || 0);
                player.seek(newTime);
              }}
              >
                <div style={{
                  width: `${player.duration ? (player.currentTime / player.duration) * 100 : 0}%`,
                  height: '100%',
                  background: '#1db954',
                  borderRadius: '2px'
                }} />
              </div>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '10px',
                color: '#666',
                marginTop: '4px'
              }}>
                <span>{formatTime(player.currentTime)}</span>
                <span>{formatTime(player.duration || song?.duration || 0)}</span>
              </div>
            </div>
          )}

          {/* 控制按钮 */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '16px',
            marginBottom: '8px'
          }}>
            <div
              onClick={() => player.playlist.length > 1 && player.playPrev()}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: player.playlist.length > 1 ? 'pointer' : 'not-allowed',
                opacity: player.playlist.length > 1 ? 1 : 0.4
              }}
            >
              <FaStepBackward size={14} />
            </div>

            <div
              onClick={() => song && player.togglePlay()}
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
              {player.loading ? (
                <Spinner style={{ width: '20px', height: '20px' }} />
              ) : player.isPlaying ? (
                <FaPause size={18} />
              ) : (
                <FaPlay size={18} style={{ marginLeft: '2px' }} />
              )}
            </div>

            <div
              onClick={() => player.playlist.length > 1 && player.playNext()}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: player.playlist.length > 1 ? 'pointer' : 'not-allowed',
                opacity: player.playlist.length > 1 ? 1 : 0.4
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

        {/* 右侧：歌词 */}
        <div style={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0
        }}>
          <div style={{ 
            fontSize: '13px', 
            color: '#8b929a', 
            marginBottom: '8px',
            flexShrink: 0
          }}>
            歌词
          </div>
          
          <div 
            ref={lyricContainerRef}
            style={{ 
              flex: 1, 
              overflow: 'auto',
              paddingRight: '8px'
            }}
          >
            {lyricLines.length > 0 ? (
              <div style={{ padding: '40px 0' }}>
                {lyricLines.map((line, index) => (
                  <div
                    key={index}
                    ref={index === currentLyricIndex ? currentLyricRef : null}
                    style={{
                      padding: '8px 12px',
                      marginBottom: '4px',
                      fontSize: index === currentLyricIndex ? '16px' : '14px',
                      color: index === currentLyricIndex ? '#1db954' : '#888',
                      fontWeight: index === currentLyricIndex ? 'bold' : 'normal',
                      transition: 'all 0.3s ease',
                      borderRadius: '6px',
                      background: index === currentLyricIndex ? 'rgba(29, 185, 84, 0.15)' : 'transparent',
                      transform: index === currentLyricIndex ? 'scale(1.02)' : 'scale(1)',
                    }}
                  >
                    <div>{line.text || '♪'}</div>
                    {line.trans && (
                      <div style={{
                        fontSize: index === currentLyricIndex ? '13px' : '12px',
                        color: index === currentLyricIndex ? 'rgba(29, 185, 84, 0.8)' : '#666',
                        marginTop: '2px'
                      }}>
                        {line.trans}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ 
                textAlign: 'center', 
                color: '#555',
                padding: '40px 16px'
              }}>
                {song ? '暂无歌词' : '选择一首歌曲开始播放'}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // 渲染猜你喜欢
  const renderGuessLike = () => (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '0 16px' }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        padding: '12px 0',
        flexShrink: 0
      }}>
        <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff' }}>
          猜你喜欢
        </div>
        <ButtonItem layout="below" onClick={() => dataManager.refreshGuessLike()} disabled={dataManager.guessLoading}>
          {dataManager.guessLoading ? '加载中...' : '换一批'}
        </ButtonItem>
      </div>
      
      <Focusable style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {dataManager.guessLoading && dataManager.guessLikeSongs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <Spinner />
          </div>
        ) : dataManager.guessLikeSongs.length > 0 ? (
          dataManager.guessLikeSongs.map((song, index) => (
            <SongItem
              key={`${song.mid}-${index}`}
              song={song}
              isPlaying={song.mid === player.currentSong?.mid}
              onClick={() => handleSelectSong(song, dataManager.guessLikeSongs, 'guess-like')}
            />
          ))
        ) : (
          <div style={{ textAlign: 'center', color: '#8b929a', padding: '40px' }}>
            暂无推荐
          </div>
        )}
      </Focusable>
    </div>
  );

  // 渲染播放队列
  const renderQueue = () => (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '0 16px' }}>
      <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff', padding: '12px 0', flexShrink: 0 }}>
        播放队列 ({player.playlist.length})
      </div>
      
      <Focusable style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {player.playlist.length > 0 ? (
          player.playlist.map((song, index) => (
            <SongItem
              key={`${song.mid}-${index}`}
              song={song}
              isPlaying={song.mid === player.currentSong?.mid}
              onClick={() => handleSelectSong(song, player.playlist)}
            />
          ))
        ) : (
          <div style={{ textAlign: 'center', color: '#8b929a', padding: '40px' }}>
            播放队列为空
          </div>
        )}
      </Focusable>
    </div>
  );

  // 渲染子页面（搜索、歌单等需要特殊处理高度）
  const renderSubPage = () => {
    switch (currentPage) {
      case 'search':
        return (
          <div style={{ height: '100%', overflow: 'auto' }}>
            <SearchPage
              onSelectSong={handleSelectSong}
              onBack={() => setCurrentPage('player')}
              currentPlayingMid={player.currentSong?.mid}
            />
          </div>
        );
      case 'playlists':
        return (
          <div style={{ height: '100%', overflow: 'auto' }}>
            <PlaylistsPage
              onSelectPlaylist={handleSelectPlaylist}
              onBack={() => setCurrentPage('player')}
            />
          </div>
        );
      case 'playlist-detail':
        return selectedPlaylist ? (
          <div style={{ height: '100%', overflow: 'auto' }}>
            <PlaylistDetailPage
              playlist={selectedPlaylist}
              onSelectSong={handleSelectSong}
              onBack={() => setCurrentPage('playlists')}
              currentPlayingMid={player.currentSong?.mid}
            />
          </div>
        ) : null;
      case 'history':
        return (
          <div style={{ height: '100%', overflow: 'auto' }}>
            <HistoryPage
              history={player.playHistory}
              onSelectSong={handleSelectSong}
              onClearHistory={player.clearPlayHistory}
              onRefreshHistory={player.refreshPlayHistory}
              onBack={() => setCurrentPage('player')}
              currentPlayingMid={player.currentSong?.mid}
            />
          </div>
        );
      default:
        return null;
    }
  };

  // 渲染内容
  const renderContent = () => {
    switch (currentPage) {
      case 'player':
        return renderPlayerPage();
      case 'guess-like':
        return renderGuessLike();
      case 'queue':
        return renderQueue();
      default:
        return renderSubPage();
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
        minHeight: 0
      }}>
        {renderContent()}
      </div>

      {/* 底部导航栏 - 固定高度 */}
      <Focusable style={{
        height: `${NAV_BAR_HEIGHT}px`,
        flexShrink: 0,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '4px',
        padding: '0 12px',
        background: 'rgba(0,0,0,0.6)',
        borderTop: '1px solid rgba(255,255,255,0.1)'
      }}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id || 
            (item.id === 'playlists' && currentPage === 'playlist-detail');
          
          return (
            <Focusable
              key={item.id}
              onActivate={() => setCurrentPage(item.id as FullscreenPageType)}
              onClick={() => setCurrentPage(item.id as FullscreenPageType)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                background: isActive ? 'rgba(29, 185, 84, 0.2)' : 'transparent',
                border: isActive ? '1px solid #1db954' : '1px solid transparent',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
                minWidth: '50px'
              }}
            >
              <Icon size={16} color={isActive ? '#1db954' : '#8b929a'} />
              <span style={{ 
                fontSize: '10px', 
                color: isActive ? '#1db954' : '#8b929a'
              }}>
                {item.label}
              </span>
            </Focusable>
          );
        })}
      </Focusable>
    </div>
  );
};

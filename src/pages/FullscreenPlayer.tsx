/**
 * 全屏音乐播放器页面
 * 从左侧菜单进入的独立页面
 */

import React, { FC, useState, useEffect, useRef, useCallback, memo } from "react";
import { Focusable, ButtonItem, Spinner } from "@decky/ui";
import { 
  FaPlay, FaPause, FaStepForward, FaStepBackward, FaMusic, 
  FaSearch, FaList, FaHistory, FaHeart, FaCompactDisc
} from "react-icons/fa";

import { getLoginStatus } from "../api";
import { toaster } from "@decky/api";
import { usePlayer, getAudioCurrentTime } from "../hooks/usePlayer";
import { useDataManager } from "../hooks/useDataManager";
import { useMountedRef } from "../hooks/useMountedRef";
import { SongItem } from "../components/SongItem";
import { LoginPage, SearchPage, PlaylistsPage, PlaylistDetailPage, HistoryPage } from "../components";
import type { SongInfo, PlaylistInfo } from "../types";
import type { QrcLyricLine, LyricWord, ParsedLyric } from "../utils/lyricParser";

// =====================================================================
// 常量样式 - 提取到组件外部避免每次渲染创建新对象
// =====================================================================

const LYRIC_CONTAINER_STYLE: React.CSSProperties = {
  flex: 1, 
  overflow: 'auto',
  padding: '20px 16px',
  scrollBehavior: 'smooth',
  scrollbarWidth: 'none',
};

const LYRIC_PADDING_STYLE: React.CSSProperties = { 
  paddingTop: '60px', 
  paddingBottom: '150px' 
};

const NO_LYRIC_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  color: 'rgba(255,255,255,0.4)',
  fontSize: '16px',
  fontWeight: 500,
};

// =====================================================================
// KaraokeLyrics - 独立的高频刷新歌词组件
// =====================================================================

interface KaraokeLyricsProps {
  lyric: ParsedLyric | null;
  isPlaying: boolean;
  hasSong: boolean;
}

interface QrcLineProps {
  line: QrcLyricLine;
  index: number;
  activeIndex: number;
  currentTimeSec: number | null;
  activeRef: React.RefObject<HTMLDivElement | null>;
}

interface LrcLineProps {
  line: { text: string; trans?: string };
  index: number;
  activeIndex: number;
  activeRef: React.RefObject<HTMLDivElement | null>;
}

const getWordProgress = (word: LyricWord, timeSec: number): number => {
  if (timeSec >= word.start + word.duration) return 100;
  if (timeSec > word.start) return ((timeSec - word.start) / word.duration) * 100;
  return 0;
};

const isInterludeLine = (text: string): boolean => {
  const trimmed = text.trim();
  return /^[/\-*~\s]+$/.test(trimmed) || trimmed.length === 0;
};

const QrcLine = memo<QrcLineProps>(({ line, index, activeIndex, currentTimeSec, activeRef }) => {
  const isActive = index === activeIndex;
  const isPast = index < activeIndex;
  const isInterlude = isInterludeLine(line.text);

  if (isInterlude) {
    return (
      <div
        ref={isActive ? activeRef : null}
        style={{
          padding: '14px 16px',
          marginBottom: '8px',
          fontSize: isActive ? '20px' : '16px',
          fontWeight: 500,
          lineHeight: 1.4,
          transition: 'font-size 0.3s ease, opacity 0.3s ease',
          color: isActive ? 'rgba(29, 185, 84, 0.6)' : 'rgba(255,255,255,0.25)',
          textAlign: 'center',
        }}
      >
        ♪ ♪ ♪
      </div>
    );
  }

  return (
    <div
      ref={isActive ? activeRef : null}
      style={{
        padding: '14px 16px',
        marginBottom: '8px',
        fontSize: isActive ? '24px' : '18px',
        fontWeight: 700,
        lineHeight: 1.4,
        transition: 'font-size 0.3s ease, transform 0.3s ease, background 0.3s ease',
        borderRadius: '8px',
        background: isActive ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
        transform: isActive ? 'scale(1.02)' : 'scale(1)',
        transformOrigin: 'left center',
      }}
    >
      <div style={{ lineHeight: 1.6 }}>
        {line.words.map((word, wordIndex) => {
          const progress = isActive && currentTimeSec !== null
            ? getWordProgress(word, currentTimeSec)
            : (isPast ? 100 : 0);
          return (
            <span key={wordIndex} style={{ position: 'relative', display: 'inline-block', whiteSpace: 'pre' }}>
              <span style={{
                color: progress >= 100 ? '#1DB954' : (isPast ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.4)'),
              }}>
                {word.text}
              </span>
              {progress > 0 && progress < 100 && (
                <span style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  color: '#1DB954',
                  clipPath: `inset(0 ${100 - progress}% 0 0)`,
                  pointerEvents: 'none',
                }}>
                  {word.text}
                </span>
              )}
            </span>
          );
        })}
      </div>

      {line.trans && (
        <div style={{
          fontSize: isActive ? '14px' : '12px',
          fontWeight: 500,
          color: isPast ? 'rgba(255,255,255,0.4)' : (isActive ? 'rgba(29, 185, 84, 0.85)' : 'rgba(255,255,255,0.3)'),
          marginTop: '6px',
          transition: 'font-size 0.3s ease, color 0.3s ease',
        }}>
          {line.trans}
        </div>
      )}
    </div>
  );
});

QrcLine.displayName = "QrcLine";

const LrcLine = memo<LrcLineProps>(({ line, index, activeIndex, activeRef }) => {
  const isActive = index === activeIndex;
  const isPast = index < activeIndex;
  return (
    <div
      ref={isActive ? activeRef : null}
      style={{
        padding: '14px 16px',
        marginBottom: '8px',
        fontSize: isActive ? '24px' : '18px',
        fontWeight: 700,
        lineHeight: 1.4,
        transition: 'all 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)',
        borderRadius: '8px',
        background: isActive ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
        transform: isActive ? 'scale(1.02)' : 'scale(1)',
        transformOrigin: 'left center',
        color: isActive ? '#1DB954' : (isPast ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.35)'),
      }}
    >
      <div>{line.text || '♪'}</div>
      {line.trans && (
        <div style={{
          fontSize: isActive ? '15px' : '13px',
          fontWeight: 500,
          color: isPast ? 'rgba(255,255,255,0.4)' : (isActive ? 'rgba(29, 185, 84, 0.8)' : 'rgba(255,255,255,0.3)'),
          marginTop: '6px',
          transition: 'all 0.35s ease',
        }}>
          {line.trans}
        </div>
      )}
    </div>
  );
});

LrcLine.displayName = "LrcLine";

/**
 * 独立的歌词组件，只有这个组件需要高频刷新
 * 使用 memo 避免父组件重渲染时不必要的更新
 */
const KaraokeLyrics = memo<KaraokeLyricsProps>(({ lyric, isPlaying, hasSong }) => {
  // 高频更新时间（仅用于 QRC 卡拉OK效果）
  const [currentTime, setCurrentTime] = useState(0);
  const animationFrameRef = useRef<number | null>(null);
  const lastUpdateTimeRef = useRef(0);
  const lastAudioTimeRef = useRef(0);
  
  // eslint-disable-next-line no-undef
  const lyricContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line no-undef
  const currentLyricRef = useRef<HTMLDivElement>(null);
  const lastComputedIndexRef = useRef(-1);
  const lastComputedTimeRef = useRef(0);
  const lastScrolledIndexRef = useRef(-1);

  // 高频时间更新（约60fps，仅在播放 QRC 歌词时）
  useEffect(() => {
    if (!isPlaying || !lyric?.isQrc) {
      if (animationFrameRef.current) {
        // eslint-disable-next-line no-undef
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const updateLoop = () => {
      // eslint-disable-next-line no-undef
      const now = performance.now();
      if (now - lastUpdateTimeRef.current >= 16) {
        lastUpdateTimeRef.current = now;
        const audioTime = getAudioCurrentTime();
        if (audioTime !== lastAudioTimeRef.current) {
          lastAudioTimeRef.current = audioTime;
          setCurrentTime(audioTime);
        }
      }
      // eslint-disable-next-line no-undef
      animationFrameRef.current = requestAnimationFrame(updateLoop);
    };

    const initialTime = getAudioCurrentTime();
    lastAudioTimeRef.current = initialTime;
    setCurrentTime(initialTime);

    // eslint-disable-next-line no-undef
    animationFrameRef.current = requestAnimationFrame(updateLoop);

    return () => {
      if (animationFrameRef.current) {
        // eslint-disable-next-line no-undef
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, lyric?.isQrc]);

  // 计算当前歌词索引
  useEffect(() => {
    lastComputedIndexRef.current = -1;
    lastComputedTimeRef.current = 0;
    lastScrolledIndexRef.current = -1;
  }, [lyric]);

  const getCurrentLyricIndex = useCallback((timeSec: number) => {
    if (!lyric) return -1;

    const isQrc = lyric.isQrc && lyric.qrcLines && lyric.qrcLines.length > 0;
    const lines = isQrc ? lyric.qrcLines || [] : lyric.lines || [];
    if (lines.length === 0) return -1;

    const timeValue = isQrc ? timeSec : timeSec * 1000;
    const lastIndex = lastComputedIndexRef.current;
    const lastTime = lastComputedTimeRef.current;

    let index = -1;
    if (timeValue < lastTime || lastIndex < 0) {
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].time <= timeValue) {
          index = i;
          break;
        }
      }
    } else {
      let i = Math.min(lastIndex, lines.length - 1);
      while (i + 1 < lines.length && lines[i + 1].time <= timeValue) {
        i++;
      }
      index = i;
    }

    lastComputedIndexRef.current = index;
    lastComputedTimeRef.current = timeValue;
    return index;
  }, [lyric]);

  const isQrc = lyric?.isQrc && (lyric?.qrcLines || []).length > 0;
  const effectiveTime = isQrc ? currentTime : getAudioCurrentTime();
  const currentLyricIndex = getCurrentLyricIndex(effectiveTime);

  // 自动滚动到当前歌词
  useEffect(() => {
    if (currentLyricIndex !== lastScrolledIndexRef.current) {
      lastScrolledIndexRef.current = currentLyricIndex;
      
      if (currentLyricRef.current && lyricContainerRef.current) {
        const container = lyricContainerRef.current;
        const current = currentLyricRef.current;
        const containerHeight = container.clientHeight;
        const targetScroll = current.offsetTop - containerHeight / 2 + current.clientHeight / 2;
        container.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
      }
    }
  }, [currentLyricIndex]);

  const lyricLines = lyric?.lines || [];
  const qrcLines = lyric?.qrcLines || [];

  return (
    <div ref={lyricContainerRef} style={LYRIC_CONTAINER_STYLE}>
      {isQrc ? (
        <div style={LYRIC_PADDING_STYLE}>
          {qrcLines.map((line, index) => (
            <QrcLine
              key={index}
              line={line}
              index={index}
              activeIndex={currentLyricIndex}
              currentTimeSec={index === currentLyricIndex ? effectiveTime : null}
              activeRef={currentLyricRef}
            />
          ))}
        </div>
      ) : lyricLines.length > 0 ? (
        <div style={LYRIC_PADDING_STYLE}>
          {lyricLines.map((line, index) => (
            <LrcLine
              key={index}
              line={line}
              index={index}
              activeIndex={currentLyricIndex}
              activeRef={currentLyricRef}
            />
          ))}
        </div>
      ) : (
        <div style={NO_LYRIC_STYLE}>
          {hasSong ? '暂无歌词' : '选择一首歌曲开始播放'}
        </div>
      )}
    </div>
  );
});

KaraokeLyrics.displayName = 'KaraokeLyrics';

// 全屏页面内的子页面类型
type FullscreenPageType = 'player' | 'guess-like' | 'playlists' | 'playlist-detail' | 'history' | 'search' | 'login';

// 底部导航项
const NAV_ITEMS = [
  { id: 'player', label: '播放', icon: FaCompactDisc },
  { id: 'guess-like', label: '推荐', icon: FaHeart },
  { id: 'playlists', label: '歌单', icon: FaList },
  { id: 'history', label: '队列', icon: FaHistory },
  { id: 'search', label: '搜索', icon: FaSearch },
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
  const mountedRef = useMountedRef();

  const player = usePlayer();
  const dataManager = useDataManager();
  const nextGuessLikeRef = useRef<SongInfo[] | null>(null);
  const nextGuessLikePromiseRef = useRef<Promise<void> | null>(null);
  
  // 保存最新状态到 ref，用于手柄快捷键
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  });

  // 检查登录状态
  useEffect(() => {
    checkLoginStatus();
  }, []);

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
    if (nextGuessLikeRef.current && nextGuessLikeRef.current.length > 0) {
      const cached = nextGuessLikeRef.current;
      nextGuessLikeRef.current = null;
      prefetchNextGuessLikeBatch();
      return cached;
    }
    const songs = await dataManager.refreshGuessLike();
    prefetchNextGuessLikeBatch();
    return songs;
  };

  const prefetchNextGuessLikeBatch = () => {
    if (nextGuessLikePromiseRef.current) return;
    nextGuessLikePromiseRef.current = dataManager.refreshGuessLike()
      .then((songs) => {
        nextGuessLikeRef.current = songs;
      })
      .catch(() => { })
      .finally(() => {
        nextGuessLikePromiseRef.current = null;
      });
  };

  // 选择歌曲
  const handleSelectSong = async (song: SongInfo, playlist?: SongInfo[], source?: string) => {
    if (playlist && playlist.length > 0) {
      const index = playlist.findIndex(s => s.mid === song.mid);
      await player.playPlaylist(playlist, index >= 0 ? index : 0);
      
      if (source === 'guess-like') {
        player.setOnNeedMoreSongs(fetchMoreGuessLikeSongs);
        prefetchNextGuessLikeBatch();
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

  const handleAddPlaylistToQueue = async (songs: SongInfo[]) => {
    if (!songs || songs.length === 0) return;
    await player.addToQueue(songs);
    toaster.toast({
      title: "已添加到播放队列",
      body: `加入 ${songs.length} 首歌曲`,
    });
  };

  // 格式化时间
  const formatTime = (seconds: number): string => {
    if (!seconds || !isFinite(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

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
            lyric={player.lyric} 
            isPlaying={player.isPlaying} 
            hasSong={!!song} 
          />
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
              onAddPlaylistToQueue={handleAddPlaylistToQueue}
              onBack={() => setCurrentPage('playlists')}
              currentPlayingMid={player.currentSong?.mid}
            />
          </div>
        ) : null;
      case 'history':
        return (
          <div style={{ height: '100%', overflow: 'auto' }}>
            <HistoryPage
            playlist={player.playlist}
            currentIndex={player.currentIndex}
            onSelectIndex={player.playAtIndex}
            onBack={() => setCurrentPage('player')}
            currentPlayingMid={player.currentSong?.mid}
            onRemoveFromQueue={player.removeFromQueue}
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

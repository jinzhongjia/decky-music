/**
 * 全屏音乐播放器页面
 * 从左侧菜单进入的独立页面
 */

import React, { FC, useState, useEffect, useRef, useCallback, memo, useMemo } from "react";
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
import { SafeImage } from "../components/SafeImage";
import { formatDuration } from "../utils/format";
import { LoginPage, SearchPage, PlaylistsPage, PlaylistDetailPage, HistoryPage } from "../components";
import type { SongInfo, PlaylistInfo } from "../types";
import type { QrcLyricLine, LyricWord, ParsedLyric } from "../utils/lyricParser";

const MemoSearchPage = memo(SearchPage);
const MemoPlaylistsPage = memo(PlaylistsPage);
const MemoPlaylistDetailPage = memo(PlaylistDetailPage);
const MemoHistoryPage = memo(HistoryPage);

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

interface NavBarProps {
  currentPage: FullscreenPageType;
  onNavigate: (page: FullscreenPageType) => void;
}

const NavBar: FC<NavBarProps> = memo(({ currentPage, onNavigate }) => (
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
          onActivate={() => onNavigate(item.id as FullscreenPageType)}
          onClick={() => onNavigate(item.id as FullscreenPageType)}
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
));

NavBar.displayName = 'NavBar';

interface GuessLikePageProps {
  songs: SongInfo[];
  loading: boolean;
  onRefresh: () => void;
  onSelectSong: (song: SongInfo) => void;
}

const GuessLikePage: FC<GuessLikePageProps> = memo(({ songs, loading, onRefresh, onSelectSong }) => (
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
      <ButtonItem layout="below" onClick={onRefresh} disabled={loading}>
        {loading ? '加载中...' : '换一批'}
      </ButtonItem>
    </div>
    
    <Focusable style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {loading && songs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <Spinner />
        </div>
      ) : songs.length > 0 ? (
        songs.map((song, index) => (
            <SongItem
              key={`${song.mid}-${index}`}
              song={song}
              onClick={() => onSelectSong(song)}
            />
          ))
        ) : (
        <div style={{ textAlign: 'center', color: '#8b929a', padding: '40px' }}>
          暂无推荐
        </div>
      )}
    </Focusable>
  </div>
));

GuessLikePage.displayName = 'GuessLikePage';

interface PlayerCoverProps {
  song: SongInfo | null;
}

const COVER_WRAPPER_STYLE: React.CSSProperties = {
  width: '180px',
  height: '180px',
  borderRadius: '8px',
  overflow: 'hidden',
  boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
  marginBottom: '16px',
  flexShrink: 0,
};

const EMPTY_COVER_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  background: 'linear-gradient(135deg, #1db954 0%, #191414 100%)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
};

const PlayerCover = memo<PlayerCoverProps>(({ song }) => (
  <div style={COVER_WRAPPER_STYLE}>
    {song?.cover ? (
      <SafeImage 
        src={song.cover}
        alt="封面"
        size={180}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    ) : (
      <div style={EMPTY_COVER_STYLE}>
        <FaMusic size={50} color="rgba(255,255,255,0.3)" />
      </div>
    )}
  </div>
));

PlayerCover.displayName = 'PlayerCover';

export const FullscreenPlayer: FC = () => {
  const [currentPage, setCurrentPage] = useState<FullscreenPageType>('player');
  const [checking, setChecking] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistInfo | null>(null);
  const [historyVisited, setHistoryVisited] = useState(false);
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
  } = player;
  const {
    guessLikeSongs,
    guessLoading,
    refreshGuessLike,
    preloadData,
  } = dataManager;
  const currentPlayingMid = currentSong?.mid;
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
    if (currentPage === 'history' && !historyVisited) {
      setHistoryVisited(true);
    }
  }, [currentPage, historyVisited]);

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
          pointerEvents: currentPage === 'history' ? 'none' : 'auto',
          opacity: currentPage === 'history' ? 0 : 1,
          transition: 'opacity 140ms ease-out',
          overflow: 'hidden',
        }}>
          {renderNonHistoryContent()}
        </div>
        {(historyVisited || currentPage === 'history') && (
          <div style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: currentPage === 'history' ? 'auto' : 'none',
            opacity: currentPage === 'history' ? 1 : 0,
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
interface PlayerMetaProps {
  song: SongInfo | null;
}

const PLAYER_TITLE_STYLE: React.CSSProperties = { 
  fontSize: '16px', 
  fontWeight: 'bold',
  marginBottom: '4px',
  color: '#fff',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
};

const PLAYER_SUBTITLE_STYLE: React.CSSProperties = { 
  fontSize: '13px', 
  color: '#8b929a',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
};

const PlayerMeta = memo<PlayerMetaProps>(({ song }) => (
  <div style={{ textAlign: 'center', marginBottom: '12px', width: '100%' }}>
    <div style={PLAYER_TITLE_STYLE}>
      {song?.name || '未播放'}
    </div>
    <div style={PLAYER_SUBTITLE_STYLE}>
      {song?.singer || '选择一首歌曲'}
    </div>
  </div>
));

PlayerMeta.displayName = 'PlayerMeta';

interface PlayerProgressProps {
  hasSong: boolean;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
}

const progressContainerStyle: React.CSSProperties = { width: '100%', maxWidth: '240px', marginBottom: '12px' };
const progressBarOuterStyle: React.CSSProperties = {
  width: '100%',
  height: '3px',
  background: 'rgba(255,255,255,0.1)',
  borderRadius: '2px',
  overflow: 'hidden',
  cursor: 'pointer'
};
const progressTimeStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: '10px',
  color: '#666',
  marginTop: '4px'
};

const PlayerProgress = memo<PlayerProgressProps>(({ hasSong, currentTime, duration, onSeek }) => {
  if (!hasSong) return null;
  const percent = duration ? (currentTime / duration) * 100 : 0;
  return (
    <div style={progressContainerStyle}>
      <div
        style={progressBarOuterStyle}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const percentClick = (e.clientX - rect.left) / rect.width;
          const newTime = percentClick * (duration || 0);
          onSeek(newTime);
        }}
      >
        <div style={{
          width: `${percent}%`,
          height: '100%',
          background: '#1db954',
          borderRadius: '2px'
        }} />
      </div>
      <div style={progressTimeStyle}>
        <span>{formatDuration(currentTime)}</span>
        <span>{formatDuration(duration)}</span>
      </div>
    </div>
  );
});

PlayerProgress.displayName = 'PlayerProgress';

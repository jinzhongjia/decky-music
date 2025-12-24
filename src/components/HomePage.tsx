/**
 * 首页组件 - 包含推荐内容
 * 使用单例缓存推荐数据，避免重复请求
 */

import { FC, useState, useEffect, useRef } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, Spinner, Focusable } from "@decky/ui";
import { FaSearch, FaSignOutAlt, FaSyncAlt, FaListUl, FaHistory } from "react-icons/fa";
import { getGuessLike, getDailyRecommend } from "../api";
import type { SongInfo } from "../types";
import { SongList } from "./SongList";
import { SongItem } from "./SongItem";

// ==================== 单例缓存 ====================
// 在模块级别保存数据，避免每次进入页面重新加载

interface RecommendCache {
  dailySongs: SongInfo[];
  guessLikeSongs: SongInfo[];
  dailyLoaded: boolean;
  guessLoaded: boolean;
}

const cache: RecommendCache = {
  dailySongs: [],
  guessLikeSongs: [],
  dailyLoaded: false,
  guessLoaded: false,
};

// 清除缓存（退出登录时调用）
export function clearRecommendCache() {
  cache.dailySongs = [];
  cache.guessLikeSongs = [];
  cache.dailyLoaded = false;
  cache.guessLoaded = false;
}

// ==================== 组件 ====================

interface HomePageProps {
  onSelectSong: (song: SongInfo, playlist?: SongInfo[], source?: string) => void;
  onGoToSearch: () => void;
  onGoToPlaylists?: () => void;
  onGoToHistory?: () => void;
  onLogout: () => void;
  currentPlayingMid?: string;
}

export const HomePage: FC<HomePageProps> = ({
  onSelectSong,
  onGoToSearch,
  onGoToPlaylists,
  onGoToHistory,
  onLogout,
  currentPlayingMid,
}) => {
  // 使用缓存的初始值
  const [dailySongs, setDailySongs] = useState<SongInfo[]>(cache.dailySongs);
  const [guessLikeSongs, setGuessLikeSongs] = useState<SongInfo[]>(cache.guessLikeSongs);
  const [loadingDaily, setLoadingDaily] = useState(!cache.dailyLoaded);
  const [loadingGuess, setLoadingGuess] = useState(!cache.guessLoaded);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    
    // 只有未加载过才请求
    if (!cache.dailyLoaded) {
      loadDailyRecommend();
    }
    if (!cache.guessLoaded) {
      loadGuessLike();
    }
    
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadDailyRecommend = async () => {
    setLoadingDaily(true);
    const result = await getDailyRecommend();
    if (!mountedRef.current) return;
    
    if (result.success) {
      setDailySongs(result.songs);
      cache.dailySongs = result.songs;
    }
    cache.dailyLoaded = true;
    setLoadingDaily(false);
  };

  const loadGuessLike = async () => {
    setLoadingGuess(true);
    const result = await getGuessLike();
    if (!mountedRef.current) return;
    
    if (result.success) {
      setGuessLikeSongs(result.songs);
      cache.guessLikeSongs = result.songs;
    }
    cache.guessLoaded = true;
    setLoadingGuess(false);
  };

  const refreshGuessLike = async () => {
    setLoadingGuess(true);
    const result = await getGuessLike();
    if (!mountedRef.current) return;
    
    if (result.success) {
      setGuessLikeSongs(result.songs);
      cache.guessLikeSongs = result.songs;
    }
    setLoadingGuess(false);
  };

  return (
    <>
      {/* 操作按钮 */}
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={onGoToSearch}>
            <FaSearch style={{ marginRight: '8px' }} />
            搜索歌曲
          </ButtonItem>
        </PanelSectionRow>
        {onGoToPlaylists && (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={onGoToPlaylists}>
              <FaListUl style={{ marginRight: '8px' }} />
              我的歌单
            </ButtonItem>
          </PanelSectionRow>
        )}
        {onGoToHistory && (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={onGoToHistory}>
              <FaHistory style={{ marginRight: '8px' }} />
              播放历史
            </ButtonItem>
          </PanelSectionRow>
        )}
      </PanelSection>

      {/* 猜你喜欢 - 放在上面 */}
      <PanelSection title={
        <Focusable style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          width: '100%',
        }}>
          <span>💡 猜你喜欢</span>
          <Focusable
            noFocusRing={false}
            onActivate={refreshGuessLike}
            onClick={refreshGuessLike}
            style={{
              padding: '4px 8px',
              borderRadius: '4px',
              background: 'rgba(255,255,255,0.1)',
              cursor: loadingGuess ? 'wait' : 'pointer',
              opacity: loadingGuess ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '12px',
            }}
          >
            <FaSyncAlt 
              size={10} 
              style={{ 
                animation: loadingGuess ? 'spin 1s linear infinite' : 'none' 
              }} 
            />
            换一批
          </Focusable>
        </Focusable>
      }>
        {loadingGuess && guessLikeSongs.length === 0 ? (
          <PanelSectionRow>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '30px' }}>
              <Spinner />
            </div>
          </PanelSectionRow>
        ) : guessLikeSongs.length === 0 ? (
          <PanelSectionRow>
            <div style={{ 
              textAlign: 'center', 
              color: '#8b929a', 
              padding: '20px',
              fontSize: '14px',
            }}>
              暂无推荐，请稍后再试
            </div>
          </PanelSectionRow>
        ) : (
          <Focusable style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {guessLikeSongs.map((song, idx) => (
              <SongItem
                key={song.mid || idx}
                song={song}
                isPlaying={currentPlayingMid === song.mid}
                onClick={(s) => onSelectSong(s, guessLikeSongs, 'guess-like')}
              />
            ))}
          </Focusable>
        )}
      </PanelSection>

      {/* 每日推荐 - 放在下面 */}
      <SongList
        title="📅 每日推荐"
        songs={dailySongs}
        loading={loadingDaily}
        currentPlayingMid={currentPlayingMid}
        emptyText="登录后查看每日推荐"
        onSelectSong={(song) => onSelectSong(song, dailySongs)}
      />

      {/* 退出登录 */}
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={onLogout}>
            <FaSignOutAlt style={{ marginRight: '8px' }} />
            退出登录
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
};


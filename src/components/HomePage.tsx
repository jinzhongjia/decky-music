/**
 * 首页组件 - 包含推荐内容
 */

import { FC, useState, useEffect, useRef } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, Spinner, Focusable } from "@decky/ui";
import { FaSearch, FaSignOutAlt, FaRedo, FaListUl, FaHistory } from "react-icons/fa";
import { getGuessLike, getDailyRecommend } from "../api";
import type { SongInfo } from "../types";
import { SongList } from "./SongList";
import { SongItem } from "./SongItem";

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
  const [dailySongs, setDailySongs] = useState<SongInfo[]>([]);
  const [guessLikeSongs, setGuessLikeSongs] = useState<SongInfo[]>([]);
  const [loadingDaily, setLoadingDaily] = useState(true);
  const [loadingGuess, setLoadingGuess] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    loadRecommendations();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadRecommendations = async () => {
    // 加载每日推荐
    setLoadingDaily(true);
    getDailyRecommend().then(result => {
      if (!mountedRef.current) return;
      if (result.success) {
        setDailySongs(result.songs);
      }
      setLoadingDaily(false);
    });

    // 加载猜你喜欢
    setLoadingGuess(true);
    getGuessLike().then(result => {
      if (!mountedRef.current) return;
      if (result.success) {
        setGuessLikeSongs(result.songs);
      }
      setLoadingGuess(false);
    });
  };

  const refreshGuessLike = async () => {
    setLoadingGuess(true);
    const result = await getGuessLike();
    if (!mountedRef.current) return;
    if (result.success) {
      setGuessLikeSongs(result.songs);
    }
    setLoadingGuess(false);
  };

  return (
    <>
      {/* 操作按钮 */}
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={onGoToSearch}
          >
            <FaSearch style={{ marginRight: '8px' }} />
            搜索歌曲
          </ButtonItem>
        </PanelSectionRow>
        {onGoToPlaylists && (
          <PanelSectionRow>
            <ButtonItem
              layout="below"
              onClick={onGoToPlaylists}
            >
              <FaListUl style={{ marginRight: '8px' }} />
              我的歌单
            </ButtonItem>
          </PanelSectionRow>
        )}
        {onGoToHistory && (
          <PanelSectionRow>
            <ButtonItem
              layout="below"
              onClick={onGoToHistory}
            >
              <FaHistory style={{ marginRight: '8px' }} />
              播放历史
            </ButtonItem>
          </PanelSectionRow>
        )}
      </PanelSection>

      {/* 每日推荐 */}
      <SongList
        title="📅 每日推荐"
        songs={dailySongs}
        loading={loadingDaily}
        showIndex={true}
        currentPlayingMid={currentPlayingMid}
        emptyText="登录后查看每日推荐"
        onSelectSong={(song) => onSelectSong(song, dailySongs)}
      />

      {/* 猜你喜欢 */}
      <PanelSection title="💡 猜你喜欢">
        {loadingGuess ? (
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
          <>
            <Focusable
              style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
            >
              {guessLikeSongs.map((song, idx) => (
                <SongItem
                  key={song.mid || idx}
                  song={song}
                  index={idx}
                  isPlaying={currentPlayingMid === song.mid}
                  onClick={(s) => onSelectSong(s, guessLikeSongs, 'guess-like')}
                />
              ))}
            </Focusable>
            
            <PanelSectionRow>
              <ButtonItem
                layout="below"
                onClick={refreshGuessLike}
                disabled={loadingGuess}
              >
                <FaRedo style={{ marginRight: '8px' }} />
                换一批
              </ButtonItem>
            </PanelSectionRow>
          </>
        )}
      </PanelSection>

      {/* 退出登录 */}
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={onLogout}
          >
            <FaSignOutAlt style={{ marginRight: '8px' }} />
            退出登录
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
};


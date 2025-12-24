/**
 * 首页组件 - 包含推荐内容
 */

import { FC, useState, useEffect } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, Spinner } from "@decky/ui";
import { FaSearch, FaSignOutAlt, FaRedo } from "react-icons/fa";
import { getGuessLike, getDailyRecommend } from "../api";
import type { SongInfo } from "../types";
import { SongList } from "./SongList";

interface HomePageProps {
  onSelectSong: (song: SongInfo) => void;
  onGoToSearch: () => void;
  onLogout: () => void;
  currentPlayingMid?: string;
}

export const HomePage: FC<HomePageProps> = ({
  onSelectSong,
  onGoToSearch,
  onLogout,
  currentPlayingMid,
}) => {
  const [dailySongs, setDailySongs] = useState<SongInfo[]>([]);
  const [guessLikeSongs, setGuessLikeSongs] = useState<SongInfo[]>([]);
  const [loadingDaily, setLoadingDaily] = useState(true);
  const [loadingGuess, setLoadingGuess] = useState(true);

  useEffect(() => {
    loadRecommendations();
  }, []);

  const loadRecommendations = async () => {
    // 加载每日推荐
    setLoadingDaily(true);
    getDailyRecommend().then(result => {
      if (result.success) {
        setDailySongs(result.songs);
      }
      setLoadingDaily(false);
    });

    // 加载猜你喜欢
    setLoadingGuess(true);
    getGuessLike().then(result => {
      if (result.success) {
        setGuessLikeSongs(result.songs);
      }
      setLoadingGuess(false);
    });
  };

  const refreshGuessLike = async () => {
    setLoadingGuess(true);
    const result = await getGuessLike();
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
      </PanelSection>

      {/* 每日推荐 */}
      <SongList
        title="📅 每日推荐"
        songs={dailySongs}
        loading={loadingDaily}
        showIndex={true}
        currentPlayingMid={currentPlayingMid}
        emptyText="登录后查看每日推荐"
        onSelectSong={onSelectSong}
      />

      {/* 猜你喜欢 */}
      <PanelSection title="💡 猜你喜欢">
        {loadingGuess ? (
          <PanelSectionRow>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '30px' }}>
              <Spinner />
            </div>
          </PanelSectionRow>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {guessLikeSongs.map((song, idx) => (
                <div
                  key={song.mid || idx}
                  onClick={() => onSelectSong(song)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 12px',
                    background: currentPlayingMid === song.mid 
                      ? 'rgba(29, 185, 84, 0.15)' 
                      : 'rgba(255,255,255,0.03)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    borderLeft: currentPlayingMid === song.mid 
                      ? '3px solid #1db954' 
                      : '3px solid transparent',
                  }}
                >
                  <img 
                    src={song.cover}
                    alt={song.name}
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '6px',
                      objectFit: 'cover',
                      background: '#2a2a2a',
                    }}
                  />
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ 
                      fontSize: '14px', 
                      fontWeight: 500,
                      color: currentPlayingMid === song.mid ? '#1db954' : '#fff',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {song.name}
                    </div>
                    <div style={{ 
                      fontSize: '12px', 
                      color: '#8b929a',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {song.singer}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
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


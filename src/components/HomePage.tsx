/**
 * 首页组件 - 包含推荐内容
 * 使用全局数据管理器，与全屏页面共享数据
 */

import { FC, useCallback, memo } from "react";
import { PanelSection, PanelSectionRow, ButtonItem } from "@decky/ui";
import { FaSearch, FaSignOutAlt, FaSyncAlt, FaListUl, FaHistory } from "react-icons/fa";
import type { SongInfo } from "../types";
import { SongList } from "./SongList";
import { SongItem } from "./SongItem";
import { useDataManager } from "../hooks/useDataManager";
import { LoadingSpinner } from "./LoadingSpinner";
import { EmptyState } from "./EmptyState";

// 清除缓存（保持向后兼容）
export function clearRecommendCache() {
  // 由 clearDataCache 处理
}

// ==================== 组件 ====================

interface HomePageProps {
  onSelectSong: (song: SongInfo, playlist?: SongInfo[], source?: string) => void;
  onGoToSearch: () => void;
  onGoToPlaylists?: () => void;
  onGoToHistory?: () => void;
  onLogout: () => void;
  currentPlayingMid?: string;
  onAddSongToQueue?: (song: SongInfo) => void;
}

const HomePageComponent: FC<HomePageProps> = ({
  onSelectSong,
  onGoToSearch,
  onGoToPlaylists,
  onGoToHistory,
  onLogout,
  currentPlayingMid,
  onAddSongToQueue,
}) => {
  const dataManager = useDataManager();

  const handleRefreshGuessLike = useCallback(() => {
    dataManager.refreshGuessLike();
  }, [dataManager]);

  const handleSongClick = useCallback(
    (song: SongInfo) => {
      onSelectSong(song, dataManager.guessLikeSongs, "guess-like");
    },
    [dataManager.guessLikeSongs, onSelectSong]
  );

  const handleDailySongClick = useCallback(
    (song: SongInfo) => {
      onSelectSong(song, dataManager.dailySongs);
    },
    [dataManager.dailySongs, onSelectSong]
  );

  return (
    <>
      {/* 操作按钮 */}
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={onGoToSearch}>
            <FaSearch style={{ marginRight: "8px" }} />
            搜索歌曲
          </ButtonItem>
        </PanelSectionRow>
        {onGoToPlaylists && (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={onGoToPlaylists}>
              <FaListUl style={{ marginRight: "8px" }} />
              我的歌单
            </ButtonItem>
          </PanelSectionRow>
        )}
        {onGoToHistory && (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={onGoToHistory}>
              <FaHistory style={{ marginRight: "8px" }} />
              播放队列
            </ButtonItem>
          </PanelSectionRow>
        )}
      </PanelSection>

      {/* 猜你喜欢 */}
      <PanelSection title="💡 猜你喜欢">
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={handleRefreshGuessLike}
            disabled={dataManager.guessLoading}
          >
            <FaSyncAlt
              size={12}
              style={{
                marginRight: "8px",
                animation: dataManager.guessLoading ? "spin 1s linear infinite" : "none",
              }}
            />
            换一批
          </ButtonItem>
        </PanelSectionRow>

        {dataManager.guessLoading && dataManager.guessLikeSongs.length === 0 ? (
          <LoadingSpinner />
        ) : dataManager.guessLikeSongs.length === 0 ? (
          <EmptyState message="暂无推荐，请稍后再试" />
        ) : (
          dataManager.guessLikeSongs.map((song, idx) => (
            <SongItem
              key={song.mid || idx}
              song={song}
              onClick={handleSongClick}
              onAddToQueue={onAddSongToQueue}
            />
          ))
        )}
      </PanelSection>

      {/* 每日推荐 */}
      <SongList
        title="📅 每日推荐"
        songs={dataManager.dailySongs}
        loading={dataManager.dailyLoading}
        currentPlayingMid={currentPlayingMid}
        emptyText="登录后查看每日推荐"
        onSelectSong={handleDailySongClick}
        onAddToQueue={onAddSongToQueue}
      />

      {/* 退出登录 */}
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={onLogout}>
            <FaSignOutAlt style={{ marginRight: "8px" }} />
            退出登录
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
};

HomePageComponent.displayName = 'HomePage';

export const HomePage = memo(HomePageComponent);

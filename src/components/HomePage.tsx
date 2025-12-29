/**
 * 首页组件 - 包含推荐内容
 * 使用全局数据管理器，与全屏页面共享数据
 */

import { FC, useCallback, memo } from "react";
import { PanelSection, PanelSectionRow, ButtonItem } from "@decky/ui";
import { FaSearch, FaSignOutAlt, FaSyncAlt, FaListUl, FaHistory, FaCog } from "react-icons/fa";
import type { SongInfo } from "../types";
import { SongList } from "./SongList";
import { SongItem } from "./SongItem";
import { useDataManager } from "../hooks/useDataManager";
import { LoadingSpinner } from "./LoadingSpinner";
import { EmptyState } from "./EmptyState";
import { useProvider, Capability } from "../providers";

// ==================== 组件 ====================

interface HomePageProps {
  onSelectSong: (song: SongInfo, playlist?: SongInfo[], source?: string) => void;
  onGoToSearch: () => void;
  onGoToPlaylists?: () => void;
  onGoToHistory?: () => void;
  onGoToSettings?: () => void;
  onLogout: () => void;
  currentPlayingMid?: string;
  onAddSongToQueue?: (song: SongInfo) => void;
  onMigrateLegacyData?: () => void;
  migratingLegacy?: boolean;
  hasLegacyData?: boolean;
}

const HomePageComponent: FC<HomePageProps> = ({
  onSelectSong,
  onGoToSearch,
  onGoToPlaylists,
  onGoToHistory,
  onGoToSettings,
  onLogout,
  currentPlayingMid,
  onAddSongToQueue,
  onMigrateLegacyData,
  migratingLegacy = false,
  hasLegacyData = false,
}) => {
  const dataManager = useDataManager();
  const { hasCapability } = useProvider();

  const canSearch = hasCapability(Capability.SEARCH);
  const canPersonalized = hasCapability(Capability.PERSONALIZED);
  const canDailyRecommend = hasCapability(Capability.DAILY_RECOMMEND);
  const canUserPlaylists = hasCapability(Capability.USER_PLAYLISTS);

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
        {canSearch && (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={onGoToSearch}>
              <FaSearch style={{ marginRight: "8px" }} />
              搜索歌曲
            </ButtonItem>
          </PanelSectionRow>
        )}
        {canUserPlaylists && onGoToPlaylists && (
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
        {onMigrateLegacyData && hasLegacyData && (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={onMigrateLegacyData} disabled={migratingLegacy}>
              <FaSyncAlt style={{ marginRight: "8px" }} />
              {migratingLegacy ? "迁移中..." : "迁移旧数据"}
            </ButtonItem>
          </PanelSectionRow>
        )}
        {onGoToSettings && (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={onGoToSettings}>
              <FaCog style={{ marginRight: "8px" }} />
              设置
            </ButtonItem>
          </PanelSectionRow>
        )}
      </PanelSection>

      {/* 猜你喜欢 */}
      {canPersonalized && (
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
      )}

      {/* 每日推荐 */}
      {canDailyRecommend && (
        <SongList
          title="📅 每日推荐"
          songs={dataManager.dailySongs}
          loading={dataManager.dailyLoading}
          currentPlayingMid={currentPlayingMid}
          emptyText="登录后查看每日推荐"
          onSelectSong={handleDailySongClick}
          onAddToQueue={onAddSongToQueue}
        />
      )}

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

HomePageComponent.displayName = "HomePage";

export const HomePage = memo(HomePageComponent);

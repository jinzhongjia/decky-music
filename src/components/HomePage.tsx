/**
 * 首页组件 - 包含推荐内容
 * 使用全局数据管理器，与全屏页面共享数据
 */

import { FC, useCallback, memo, useEffect } from "react";
import { PanelSection, PanelSectionRow, ButtonItem } from "@decky/ui";
import { FaSearch, FaSignOutAlt, FaListUl, FaHistory, FaCog } from "react-icons/fa";
import type { SongInfo } from "../types";
import { SongList } from "./SongList";
import { GuessLikeSection } from "./GuessLikeSection";
import { useDataManager } from "../hooks/useDataManager";
import { useProvider } from "../hooks/useProvider";
import { useAuthStatus } from "../state/authState";

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
  onGoToSettings?: () => void;
  onLogout: () => void;
  currentPlayingMid?: string;
  onAddSongToQueue?: (song: SongInfo) => void;
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
}) => {
  const dataManager = useDataManager();
  const { hasCapability, provider } = useProvider();
  const isLoggedIn = useAuthStatus();

  const canSearch = hasCapability("search.song");
  const canViewPlaylists = hasCapability("playlist.user");
  const canRecommendPersonalized = hasCapability("recommend.personalized");
  const canRecommendDaily = hasCapability("recommend.daily");
  const isNetease = provider?.id === "netease";

  // 登录后自动加载每日推荐
  useEffect(() => {
    if (
      isLoggedIn &&
      canRecommendDaily &&
      !dataManager.dailyLoaded &&
      !dataManager.dailyLoading &&
      dataManager.dailySongs.length === 0
    ) {
      void dataManager.loadDailyRecommend();
    }
  }, [isLoggedIn, canRecommendDaily, dataManager]);

  // 登录后自动加载猜你喜欢
  useEffect(() => {
    if (
      isLoggedIn &&
      canRecommendPersonalized &&
      !dataManager.guessLoaded &&
      !dataManager.guessLoading &&
      dataManager.guessLikeSongs.length === 0
    ) {
      void dataManager.loadGuessLike();
    }
  }, [isLoggedIn, canRecommendPersonalized, dataManager]);

  const handleRefreshGuessLike = useCallback(() => {
    dataManager.refreshGuessLike();
  }, [dataManager]);

  const handleGuessLikeSongClick = useCallback(
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
        {canViewPlaylists && onGoToPlaylists && (
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
      {canRecommendPersonalized && (
        <GuessLikeSection
          songs={dataManager.guessLikeSongs}
          loading={dataManager.guessLoading}
          onRefresh={handleRefreshGuessLike}
          onSelectSong={handleGuessLikeSongClick}
          onAddToQueue={onAddSongToQueue}
          disableRefresh={isNetease}
          variant="panel"
        />
      )}

      {/* 每日推荐 */}
      {canRecommendDaily && (
        <SongList
          title="📅 每日推荐"
          songs={dataManager.dailySongs}
          loading={dataManager.dailyLoading}
          currentPlayingMid={currentPlayingMid}
          emptyText={isLoggedIn ? "暂无每日推荐" : "登录后查看每日推荐"}
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

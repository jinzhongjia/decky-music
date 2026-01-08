/**
 * 歌单列表页面
 * 使用全局数据管理器，与全屏页面共享数据
 */

import { FC, useCallback, memo, useMemo, useEffect } from "react";
import { PanelSection, Field } from "@decky/ui";
import type { PlaylistInfo } from "../../types";
import { formatPlayCount } from "../../utils/format";
import { useDataManager } from "../../features/data";
import { useProvider } from "../../hooks/useProvider";
import { useAuthStatus } from "../../features/auth";
import { BackButton, LoadingSpinner, EmptyState, SafeImage } from "../../components/common";
import { TEXT_ELLIPSIS, TEXT_CONTAINER, COLORS } from "../../utils/styles";

interface PlaylistsPageProps {
  onSelectPlaylist: (playlist: PlaylistInfo) => void;
  onBack: () => void;
}

const PlaylistItemComponent: FC<{
  playlist: PlaylistInfo;
  onClick: () => void;
}> = ({ playlist, onClick }) => (
  <div
    style={{
      background: COLORS.backgroundLight,
      borderRadius: "8px",
      marginBottom: "4px",
    }}
  >
    <Field
      focusable
      highlightOnFocus
      onActivate={onClick}
      onClick={onClick}
      bottomSeparator="none"
      padding="none"
      label={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "10px 12px",
            width: "100%",
            minWidth: 0,
          }}
        >
          <SafeImage
            src={playlist.cover}
            alt={playlist.name}
            size={48}
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "6px",
              objectFit: "cover",
              background: COLORS.backgroundDarkBase,
              flexShrink: 0,
            }}
          />
          <div style={{ ...TEXT_CONTAINER, maxWidth: "100%" }}>
            <div
              style={{
                fontSize: "14px",
                fontWeight: 500,
                color: COLORS.textPrimary,
                ...TEXT_ELLIPSIS,
              }}
            >
              {playlist.name || "未命名歌单"}
            </div>
            <div
              style={{
                fontSize: "12px",
                color: COLORS.textSecondary,
                marginTop: "2px",
              }}
            >
              {playlist.songCount || 0} 首{playlist.creator && ` · ${playlist.creator}`}
              {playlist.playCount &&
                playlist.playCount > 0 &&
                ` · ${formatPlayCount(playlist.playCount)}次播放`}
            </div>
          </div>
        </div>
      }
    />
  </div>
);

PlaylistItemComponent.displayName = 'PlaylistItem';

const PlaylistItem = memo(PlaylistItemComponent);

const PlaylistsPageComponent: FC<PlaylistsPageProps> = ({ onSelectPlaylist, onBack }) => {
  const dataManager = useDataManager();
  const { hasCapability } = useProvider();
  const isLoggedIn = useAuthStatus();

  const canViewPlaylists = hasCapability("playlist.user");

  // 登录后自动加载歌单
  useEffect(() => {
    if (
      isLoggedIn &&
      canViewPlaylists &&
      !dataManager.playlistsLoaded &&
      !dataManager.playlistsLoading &&
      dataManager.createdPlaylists.length === 0 &&
      dataManager.collectedPlaylists.length === 0
    ) {
      void dataManager.loadPlaylists();
    }
  }, [isLoggedIn, canViewPlaylists, dataManager]);

  const handlePlaylistClick = useCallback(
    (playlist: PlaylistInfo) => {
      onSelectPlaylist(playlist);
    },
    [onSelectPlaylist]
  );

  // 为每个歌单创建稳定的点击处理函数
  const createdPlaylistHandlers = useMemo(
    () =>
      dataManager.createdPlaylists.reduce(
        (acc, playlist) => {
          acc[playlist.id] = () => handlePlaylistClick(playlist);
          return acc;
        },
        {} as Record<string, () => void>
      ),
    [dataManager.createdPlaylists, handlePlaylistClick]
  );

  const collectedPlaylistHandlers = useMemo(
    () =>
      dataManager.collectedPlaylists.reduce(
        (acc, playlist) => {
          acc[playlist.id] = () => handlePlaylistClick(playlist);
          return acc;
        },
        {} as Record<string, () => void>
      ),
    [dataManager.collectedPlaylists, handlePlaylistClick]
  );

  if (dataManager.playlistsLoading && dataManager.createdPlaylists.length === 0) {
    return (
      <PanelSection title="📂 我的歌单">
        <LoadingSpinner padding={40} />
      </PanelSection>
    );
  }

  return (
    <>
      <BackButton onClick={onBack} label="返回首页" />

      {/* 创建的歌单 */}
      <PanelSection title={`💿 创建的歌单 (${dataManager.createdPlaylists.length})`}>
        {dataManager.createdPlaylists.length === 0 ? (
          <EmptyState message="暂无创建的歌单" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {dataManager.createdPlaylists.map((playlist) => (
              <PlaylistItem
                key={playlist.id}
                playlist={playlist}
                onClick={createdPlaylistHandlers[playlist.id] || (() => handlePlaylistClick(playlist))}
              />
            ))}
          </div>
        )}
      </PanelSection>

      {/* 收藏的歌单 */}
      <PanelSection title={`❤️ 收藏的歌单 (${dataManager.collectedPlaylists.length})`}>
        {dataManager.collectedPlaylists.length === 0 ? (
          <EmptyState message="暂无收藏的歌单" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {dataManager.collectedPlaylists.map((playlist) => (
              <PlaylistItem
                key={playlist.id}
                playlist={playlist}
                onClick={collectedPlaylistHandlers[playlist.id] || (() => handlePlaylistClick(playlist))}
              />
            ))}
          </div>
        )}
      </PanelSection>
    </>
  );
};

PlaylistsPageComponent.displayName = 'PlaylistsPage';

export const PlaylistsPage = memo(PlaylistsPageComponent);

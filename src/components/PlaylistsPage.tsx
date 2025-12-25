/**
 * 歌单列表页面
 * 使用全局数据管理器，与全屏页面共享数据
 */

import { FC } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, Field } from "@decky/ui";
import type { PlaylistInfo } from "../types";
import { formatPlayCount } from "../utils/format";
import { useDataManager } from "../hooks/useDataManager";
import { BackButton } from "./BackButton";
import { LoadingSpinner } from "./LoadingSpinner";
import { EmptyState } from "./EmptyState";
import { SafeImage } from "./SafeImage";

interface PlaylistsPageProps {
  onSelectPlaylist: (playlist: PlaylistInfo) => void;
  onBack: () => void;
}

const PlaylistItem: FC<{
  playlist: PlaylistInfo;
  onClick: () => void;
}> = ({ playlist, onClick }) => (
  <div style={{
    background: 'rgba(255,255,255,0.03)',
    borderRadius: '8px',
    marginBottom: '4px',
  }}>
    <Field
      focusable
      highlightOnFocus
      onActivate={onClick}
      onClick={onClick}
      bottomSeparator="none"
      padding="none"
      label={
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '10px 12px',
        }}>
          <SafeImage
            src={playlist.cover}
            alt={playlist.name}
            size={48}
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '6px',
              objectFit: 'cover',
              background: '#2a2a2a',
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
            <div style={{
              fontSize: '14px',
              fontWeight: 500,
              color: '#fff',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {playlist.name || '未命名歌单'}
            </div>
            <div style={{
              fontSize: '12px',
              color: '#8b929a',
              marginTop: '2px',
            }}>
              {playlist.songCount || 0} 首
              {playlist.creator && ` · ${playlist.creator}`}
              {playlist.playCount && playlist.playCount > 0 && ` · ${formatPlayCount(playlist.playCount)}次播放`}
            </div>
          </div>
        </div>
      }
    />
  </div>
);

export const PlaylistsPage: FC<PlaylistsPageProps> = ({
  onSelectPlaylist,
  onBack,
}) => {
  const dataManager = useDataManager();

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
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {dataManager.createdPlaylists.map((playlist) => (
              <PlaylistItem
                key={playlist.id}
                playlist={playlist}
                onClick={() => onSelectPlaylist(playlist)}
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
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {dataManager.collectedPlaylists.map((playlist) => (
              <PlaylistItem
                key={playlist.id}
                playlist={playlist}
                onClick={() => onSelectPlaylist(playlist)}
              />
            ))}
          </div>
        )}
      </PanelSection>
    </>
  );
};

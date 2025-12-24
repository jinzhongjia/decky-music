/**
 * 歌单列表页面
 */

import { FC, useState, useEffect, useRef } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, Spinner, Focusable } from "@decky/ui";
import { FaArrowLeft } from "react-icons/fa";
import { getUserPlaylists } from "../api";
import type { PlaylistInfo } from "../types";
import { formatPlayCount, getDefaultCover } from "../utils/format";

interface PlaylistsPageProps {
  onSelectPlaylist: (playlist: PlaylistInfo) => void;
  onBack: () => void;
}

const PlaylistItem: FC<{
  playlist: PlaylistInfo;
  onClick: () => void;
}> = ({ playlist, onClick }) => (
  <Focusable
    onActivate={onClick}
    onClick={onClick}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '10px 12px',
      background: 'rgba(255,255,255,0.03)',
      borderRadius: '8px',
      cursor: 'pointer',
      transition: 'background 0.2s',
    }}
  >
    <img
      src={playlist.cover || getDefaultCover(48)}
      alt={playlist.name}
      style={{
        width: '48px',
        height: '48px',
        borderRadius: '6px',
        objectFit: 'cover',
        background: '#2a2a2a',
        flexShrink: 0,
      }}
      onError={(e) => {
        (e.target as HTMLImageElement).src = getDefaultCover(48);
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
        {playlist.name}
      </div>
      <div style={{
        fontSize: '12px',
        color: '#8b929a',
        marginTop: '2px',
      }}>
        {playlist.songCount} 首
        {playlist.creator && ` · ${playlist.creator}`}
        {playlist.playCount && playlist.playCount > 0 && ` · ${formatPlayCount(playlist.playCount)}次播放`}
      </div>
    </div>
  </Focusable>
);

export const PlaylistsPage: FC<PlaylistsPageProps> = ({
  onSelectPlaylist,
  onBack,
}) => {
  const [createdPlaylists, setCreatedPlaylists] = useState<PlaylistInfo[]>([]);
  const [collectedPlaylists, setCollectedPlaylists] = useState<PlaylistInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    loadPlaylists();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadPlaylists = async () => {
    setLoading(true);
    const result = await getUserPlaylists();
    if (!mountedRef.current) return;
    
    if (result.success) {
      setCreatedPlaylists(result.created);
      setCollectedPlaylists(result.collected);
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <PanelSection title="📂 我的歌单">
        <PanelSectionRow>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
            <Spinner />
          </div>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  return (
    <>
      {/* 返回按钮 */}
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={onBack}>
            <FaArrowLeft style={{ marginRight: '8px' }} />
            返回首页
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      {/* 创建的歌单 */}
      <PanelSection title={`💿 创建的歌单 (${createdPlaylists.length})`}>
        {createdPlaylists.length === 0 ? (
          <PanelSectionRow>
            <div style={{ textAlign: 'center', color: '#8b929a', padding: '20px' }}>
              暂无创建的歌单
            </div>
          </PanelSectionRow>
        ) : (
          <Focusable style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {createdPlaylists.map((playlist) => (
              <PlaylistItem
                key={playlist.id}
                playlist={playlist}
                onClick={() => onSelectPlaylist(playlist)}
              />
            ))}
          </Focusable>
        )}
      </PanelSection>

      {/* 收藏的歌单 */}
      <PanelSection title={`❤️ 收藏的歌单 (${collectedPlaylists.length})`}>
        {collectedPlaylists.length === 0 ? (
          <PanelSectionRow>
            <div style={{ textAlign: 'center', color: '#8b929a', padding: '20px' }}>
              暂无收藏的歌单
            </div>
          </PanelSectionRow>
        ) : (
          <Focusable style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {collectedPlaylists.map((playlist) => (
              <PlaylistItem
                key={playlist.id}
                playlist={playlist}
                onClick={() => onSelectPlaylist(playlist)}
              />
            ))}
          </Focusable>
        )}
      </PanelSection>
    </>
  );
};


/**
 * 歌单详情页面
 */

import { FC, useState, useEffect } from "react";
import { PanelSection, PanelSectionRow, ButtonItem } from "@decky/ui";
import { FaPlay } from "react-icons/fa";
import { getPlaylistSongs } from "../api";
import type { PlaylistInfo, SongInfo } from "../types";
import { BackButton } from "./BackButton";
import { SafeImage } from "./SafeImage";
import { SongList } from "./SongList";
import { useMountedRef } from "../hooks/useMountedRef";
import { TEXT_ELLIPSIS_2_LINES, COLORS } from "../utils/styles";

interface PlaylistDetailPageProps {
  playlist: PlaylistInfo;
  onSelectSong: (song: SongInfo, playlist?: SongInfo[], source?: string) => void;
  onBack: () => void;
  currentPlayingMid?: string;
}

export const PlaylistDetailPage: FC<PlaylistDetailPageProps> = ({
  playlist,
  onSelectSong,
  onBack,
  currentPlayingMid,
}) => {
  const [songs, setSongs] = useState<SongInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useMountedRef();

  useEffect(() => {
    loadSongs();
  }, [playlist.id]);

  const loadSongs = async () => {
    setLoading(true);
    const result = await getPlaylistSongs(playlist.id, playlist.dirid || 0);
    if (!mountedRef.current) return;
    
    if (result.success) {
      setSongs(result.songs);
    }
    setLoading(false);
  };

  const handlePlayAll = () => {
    if (songs.length > 0) {
      onSelectSong(songs[0], songs);
    }
  };

  return (
    <>
      <BackButton onClick={onBack} label="返回歌单列表" />

      {/* 歌单信息 */}
      <PanelSection>
        <PanelSectionRow>
          <div style={{ display: 'flex', gap: '16px', padding: '10px 0' }}>
            <SafeImage
              src={playlist.cover}
              alt={playlist.name}
              size={80}
              style={{
                width: '80px',
                height: '80px',
                borderRadius: '8px',
                objectFit: 'cover',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: '16px',
                fontWeight: 600,
                color: COLORS.textPrimary,
                marginBottom: '6px',
                ...TEXT_ELLIPSIS_2_LINES,
              }}>
                {playlist.name}
              </div>
              <div style={{ fontSize: '13px', color: COLORS.textSecondary }}>
                {playlist.songCount} 首歌曲
                {playlist.creator && ` · ${playlist.creator}`}
              </div>
            </div>
          </div>
        </PanelSectionRow>

        {/* 播放全部按钮 */}
        {!loading && songs.length > 0 && (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={handlePlayAll}>
              <FaPlay style={{ marginRight: '8px' }} />
              播放全部
            </ButtonItem>
          </PanelSectionRow>
        )}
      </PanelSection>

      {/* 歌曲列表 */}
      <SongList
        title={`歌曲列表${songs.length > 0 ? ` (${songs.length})` : ''}`}
        songs={songs}
        loading={loading}
        currentPlayingMid={currentPlayingMid}
        emptyText="歌单暂无歌曲"
        onSelectSong={(song) => onSelectSong(song, songs)}
      />
    </>
  );
};


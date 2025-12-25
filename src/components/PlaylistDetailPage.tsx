/**
 * 歌单详情页面
 */

import { FC, useState, useEffect, useCallback, memo, useRef } from "react";
import { PanelSection, PanelSectionRow, ButtonItem } from "@decky/ui";
import { FaPlus } from "react-icons/fa";
import { getPlaylistSongs } from "../api";
import type { PlaylistInfo, SongInfo } from "../types";
import { BackButton } from "./BackButton";
import { SafeImage } from "./SafeImage";
import { SongList } from "./SongList";
import { PlayAllButton } from "./PlayAllButton";
import { useMountedRef } from "../hooks/useMountedRef";
import { TEXT_ELLIPSIS_2_LINES, COLORS } from "../utils/styles";

interface PlaylistDetailPageProps {
  playlist: PlaylistInfo;
  onSelectSong: (song: SongInfo, playlist?: SongInfo[], source?: string) => void;
  onAddPlaylistToQueue?: (songs: SongInfo[]) => void;
  onAddSongToQueue?: (song: SongInfo) => void;
  onBack: () => void;
  currentPlayingMid?: string;
}

const PlaylistDetailPageComponent: FC<PlaylistDetailPageProps> = ({
  playlist,
  onSelectSong,
  onAddPlaylistToQueue,
  onAddSongToQueue,
  onBack,
  currentPlayingMid,
}) => {
  const [songs, setSongs] = useState<SongInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useMountedRef();
  const requestIdRef = useRef(0);

  const loadSongs = useCallback(async () => {
    setLoading(true);
    const requestId = ++requestIdRef.current;
    const result = await getPlaylistSongs(playlist.id, playlist.dirid || 0);
    if (!mountedRef.current || requestId !== requestIdRef.current) return;

    if (result.success) {
      setSongs(result.songs);
    }
    setLoading(false);
  }, [mountedRef, playlist.id, playlist.dirid]);

  useEffect(() => {
    loadSongs();
  }, [loadSongs]);

  const handlePlayAll = useCallback(() => {
    if (songs.length > 0) {
      onSelectSong(songs[0], songs);
    }
  }, [songs, onSelectSong]);

  const handleAddToQueue = useCallback(() => {
    if (!onAddPlaylistToQueue || songs.length === 0) return;
    onAddPlaylistToQueue(songs);
  }, [onAddPlaylistToQueue, songs]);

  const handleSongSelect = useCallback(
    (song: SongInfo) => {
      onSelectSong(song, songs);
    },
    [songs, onSelectSong]
  );

  return (
    <>
      <BackButton onClick={onBack} label="返回歌单列表" />

      {/* 歌单信息 */}
      <PanelSection>
        <PanelSectionRow>
          <div style={{ display: "flex", gap: "16px", padding: "10px 0" }}>
            <SafeImage
              src={playlist.cover}
              alt={playlist.name}
              size={80}
              style={{
                width: "80px",
                height: "80px",
                borderRadius: "8px",
                objectFit: "cover",
                boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: 600,
                  color: COLORS.textPrimary,
                  marginBottom: "6px",
                  ...TEXT_ELLIPSIS_2_LINES,
                }}
              >
                {playlist.name}
              </div>
              <div style={{ fontSize: "13px", color: COLORS.textSecondary }}>
                {playlist.songCount} 首歌曲
                {playlist.creator && ` · ${playlist.creator}`}
              </div>
            </div>
          </div>
        </PanelSectionRow>

        {/* 播放全部按钮 */}
        <PlayAllButton onClick={handlePlayAll} show={!loading && songs.length > 0} />

        {/* 添加到队列 */}
        {!loading && songs.length > 0 && onAddPlaylistToQueue && (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={handleAddToQueue}>
              <FaPlus style={{ marginRight: "8px" }} />
              添加到播放队列
            </ButtonItem>
          </PanelSectionRow>
        )}
      </PanelSection>

      {/* 歌曲列表 */}
      <SongList
        title={`歌曲列表${songs.length > 0 ? ` (${songs.length})` : ""}`}
        songs={songs}
        loading={loading}
        currentPlayingMid={currentPlayingMid}
        emptyText="歌单暂无歌曲"
        onSelectSong={handleSongSelect}
        onAddToQueue={onAddSongToQueue}
      />
    </>
  );
};

PlaylistDetailPageComponent.displayName = 'PlaylistDetailPage';

export const PlaylistDetailPage = memo(PlaylistDetailPageComponent);

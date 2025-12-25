/**
 * 歌单详情页面
 */

import { FC, useState, useEffect, useRef } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, Spinner, Focusable } from "@decky/ui";
import { FaPlay } from "react-icons/fa";
import { getPlaylistSongs } from "../api";
import type { PlaylistInfo, SongInfo } from "../types";
import { getDefaultCover } from "../utils/format";
import { SongItem } from "./SongItem";
import { BackButton } from "./BackButton";

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
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    loadSongs();
    return () => {
      mountedRef.current = false;
    };
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
            <img
              src={playlist.cover || getDefaultCover(80)}
              alt={playlist.name}
              style={{
                width: '80px',
                height: '80px',
                borderRadius: '8px',
                objectFit: 'cover',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              }}
              onError={(e) => {
                (e.target as HTMLImageElement).src = getDefaultCover(80);
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: '16px',
                fontWeight: 600,
                color: '#fff',
                marginBottom: '6px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
              }}>
                {playlist.name}
              </div>
              <div style={{ fontSize: '13px', color: '#8b929a' }}>
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
      <PanelSection title={`歌曲列表${songs.length > 0 ? ` (${songs.length})` : ''}`}>
        {loading ? (
          <PanelSectionRow>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '30px' }}>
              <Spinner />
            </div>
          </PanelSectionRow>
        ) : songs.length === 0 ? (
          <PanelSectionRow>
            <div style={{ textAlign: 'center', color: '#8b929a', padding: '20px' }}>
              歌单暂无歌曲
            </div>
          </PanelSectionRow>
        ) : (
          <Focusable style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {songs.map((song, idx) => (
              <SongItem
                key={song.mid || idx}
                song={song}
                isPlaying={currentPlayingMid === song.mid}
                onClick={(s) => onSelectSong(s, songs)}
              />
            ))}
          </Focusable>
        )}
      </PanelSection>
    </>
  );
};


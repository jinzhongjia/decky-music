/**
 * 歌曲列表组件
 */

import { FC } from "react";
import { PanelSection, PanelSectionRow } from "@decky/ui";
import type { SongInfo } from "../types";
import { SongItem } from "./SongItem";
import { LoadingSpinner } from "./LoadingSpinner";

interface SongListProps {
  title: string;
  songs: SongInfo[];
  loading?: boolean;
  currentPlayingMid?: string;
  emptyText?: string;
  onSelectSong: (song: SongInfo) => void;
}

export const SongList: FC<SongListProps> = ({
  title,
  songs,
  loading = false,
  currentPlayingMid,
  emptyText = "暂无歌曲",
  onSelectSong,
}) => {
  if (loading) {
    return (
      <PanelSection title={title}>
        <LoadingSpinner />
      </PanelSection>
    );
  }

  if (songs.length === 0) {
    return (
      <PanelSection title={title}>
        <PanelSectionRow>
          <div style={{ 
            textAlign: 'center', 
            color: '#8b929a', 
            padding: '20px',
            fontSize: '14px',
          }}>
            {emptyText}
          </div>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  return (
    <PanelSection title={title}>
      {songs.map((song, idx) => (
        <SongItem
          key={song.mid || idx}
          song={song}
          isPlaying={currentPlayingMid === song.mid}
          onClick={onSelectSong}
        />
      ))}
    </PanelSection>
  );
};


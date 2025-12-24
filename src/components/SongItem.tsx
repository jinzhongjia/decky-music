/**
 * 歌曲列表项组件
 * 移除序列号，简化显示
 */

import { FC } from "react";
import { Focusable } from "@decky/ui";
import type { SongInfo } from "../types";
import { formatDuration, getDefaultCover } from "../utils/format";

interface SongItemProps {
  song: SongInfo;
  isPlaying?: boolean;
  onClick: (song: SongInfo) => void;
}

export const SongItem: FC<SongItemProps> = ({ 
  song, 
  isPlaying = false,
  onClick 
}) => {
  const handleClick = () => onClick(song);
  
  return (
    <Focusable
      noFocusRing={false}
      onActivate={handleClick}
      onClick={handleClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 12px',
        background: isPlaying ? 'rgba(29, 185, 84, 0.15)' : 'rgba(255,255,255,0.03)',
        borderRadius: '8px',
        cursor: 'pointer',
        width: '100%',
        borderLeft: isPlaying ? '3px solid #1db954' : '3px solid transparent',
      }}
    >
      <img 
        src={song.cover}
        alt={song.name}
        style={{
          width: '44px',
          height: '44px',
          borderRadius: '6px',
          objectFit: 'cover',
          background: '#2a2a2a',
          flexShrink: 0,
        }}
        onError={(e) => {
          (e.target as HTMLImageElement).src = getDefaultCover(44);
        }}
      />
      
      <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
        <div style={{ 
          fontSize: '14px', 
          fontWeight: 500,
          color: isPlaying ? '#1db954' : '#fff',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {song.name}
        </div>
        <div style={{ 
          fontSize: '12px', 
          color: '#8b929a',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          marginTop: '2px',
        }}>
          {song.singer}{song.album ? ` · ${song.album}` : ''}
        </div>
      </div>
      
      <div style={{ 
        color: '#8b929a', 
        fontSize: '12px',
        flexShrink: 0,
      }}>
        {formatDuration(song.duration)}
      </div>
    </Focusable>
  );
};


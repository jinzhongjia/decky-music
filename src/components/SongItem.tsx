/**
 * 歌曲列表项组件
 * 使用 Field 组件获得焦点高亮效果
 */

import { FC } from "react";
import { Field } from "@decky/ui";
import type { SongInfo } from "../types";
import { formatDuration } from "../utils/format";
import { SafeImage } from "./SafeImage";
import { TEXT_ELLIPSIS, TEXT_CONTAINER, COLORS } from "../utils/styles";

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
    <div style={{
      background: isPlaying ? COLORS.primaryBg : COLORS.transparent,
      borderLeft: isPlaying ? `3px solid ${COLORS.primary}` : '3px solid transparent',
      borderRadius: '8px',
      marginBottom: '4px',
    }}>
      <Field
        focusable
        highlightOnFocus
        onActivate={handleClick}
        onClick={handleClick}
        bottomSeparator="none"
        padding="none"
        label={
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '10px',
            padding: '8px 10px',
          }}>
            <SafeImage 
              src={song.cover}
              alt={song.name}
              size={40}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '6px',
                objectFit: 'cover',
                background: COLORS.backgroundDarkBase,
                flexShrink: 0,
              }}
            />
            <div style={TEXT_CONTAINER}>
              <div style={{ 
                fontSize: '13px', 
                fontWeight: 500,
                color: isPlaying ? COLORS.primary : COLORS.textPrimary,
                ...TEXT_ELLIPSIS,
              }}>
                {song.name}
              </div>
              <div style={{ 
                fontSize: '11px', 
                color: COLORS.textSecondary,
                ...TEXT_ELLIPSIS,
                marginTop: '2px',
              }}>
                {song.singer}
              </div>
            </div>
            <div style={{ 
              color: COLORS.textSecondary, 
              fontSize: '11px',
              flexShrink: 0,
            }}>
              {formatDuration(song.duration)}
            </div>
          </div>
        }
      />
    </div>
  );
};


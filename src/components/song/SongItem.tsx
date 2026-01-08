import React, { FC, memo, useCallback } from "react";
import { Field } from "@decky/ui";
import { FaPlus, FaTrash, FaVolumeUp } from "react-icons/fa";
import type { SongInfo } from "../../types";
import { formatDuration } from "../../utils/format";
import { SafeImage } from "../common";
import { TEXT_ELLIPSIS, TEXT_CONTAINER, COLORS } from "../../utils/styles";

interface SongItemProps {
  song: SongInfo;
  isPlaying?: boolean;
  onClick: (song: SongInfo) => void;
  onAddToQueue?: (song: SongInfo) => void;
  onRemoveFromQueue?: (song: SongInfo) => void;
  preferredFocus?: boolean;
}

const SongItemComponent: FC<SongItemProps> = ({
  song,
  isPlaying = false,
  onClick,
  onAddToQueue,
  onRemoveFromQueue,
  preferredFocus = false,
}) => {
  const handleClick = useCallback(() => onClick(song), [onClick, song]);
  const handleAdd = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onAddToQueue?.(song);
  }, [onAddToQueue, song]);
  const handleRemove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onRemoveFromQueue?.(song);
  }, [onRemoveFromQueue, song]);
  
  return (
    <div
      style={{
        background: isPlaying ? COLORS.backgroundLight : COLORS.transparent,
        border: isPlaying ? `1px solid ${COLORS.primary}` : "1px solid rgba(255,255,255,0.05)",
        borderRadius: "10px",
        marginBottom: "6px",
        boxShadow: isPlaying ? `0 2px 10px ${COLORS.primaryShadow}` : "none",
      }}
    >
      <Field
        focusable
        highlightOnFocus
        preferredFocus={preferredFocus}
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
            minWidth: 0,
            width: '100%',
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
            <div style={{ ...TEXT_CONTAINER, flex: 1 }}>
              <div style={{ 
                fontSize: '13px', 
                fontWeight: 600,
                color: isPlaying ? COLORS.primary : COLORS.textPrimary,
                maxWidth: '100%',
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
            <div
              style={{
                color: COLORS.textSecondary,
                fontSize: "11px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                marginLeft: "auto",
                flexShrink: 0,
                whiteSpace: "nowrap",
                justifyContent: "flex-end",
              }}
            >
              {isPlaying && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    color: COLORS.primary,
                    background: COLORS.primaryBg,
                    padding: "4px 8px",
                    borderRadius: "999px",
                    fontSize: "11px",
                  }}
                >
                  <FaVolumeUp size={10} />
                  播放中
                </span>
              )}
              {formatDuration(song.duration)}
              {onAddToQueue && (
                <button
                  onClick={handleAdd}
                  title="添加到队列"
                  style={{
                    border: 'none',
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    background: COLORS.backgroundDark,
                    color: COLORS.textPrimary,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <FaPlus size={12} />
                </button>
              )}
              {onRemoveFromQueue && (
                <button
                  onClick={handleRemove}
                  title="从队列移除"
                  style={{
                    border: 'none',
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    background: COLORS.errorBg,
                    color: COLORS.error,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <FaTrash size={12} />
                </button>
              )}
            </div>
          </div>
        }
      />
    </div>
  );
};

SongItemComponent.displayName = 'SongItem';

export const SongItem = memo(SongItemComponent);

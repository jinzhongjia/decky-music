/**
 * 迷你播放器组件 - 底部播放条
 */

import { FC } from "react";
import { Focusable } from "@decky/ui";
import { FaPlay, FaPause, FaStepForward, FaStepBackward } from "react-icons/fa";
import type { SongInfo } from "../types";
import { formatDuration, getDefaultCover } from "../utils/format";

interface PlayerBarProps {
  song: SongInfo;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  loading?: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onClick: () => void;
}

export const PlayerBar: FC<PlayerBarProps> = ({
  song,
  isPlaying,
  currentTime,
  duration,
  loading = false,
  onTogglePlay,
  onSeek,
  onClick,
}) => {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div style={{
      position: 'sticky',
      bottom: 0,
      left: 0,
      right: 0,
      background: 'linear-gradient(to top, rgba(20, 20, 20, 0.98), rgba(30, 30, 30, 0.95))',
      borderTop: '1px solid rgba(255,255,255,0.1)',
      padding: '8px 12px',
      backdropFilter: 'blur(10px)',
    }}>
      {/* 进度条 */}
      <div 
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3px',
          background: 'rgba(255,255,255,0.1)',
          cursor: 'pointer',
        }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const percent = (e.clientX - rect.left) / rect.width;
          onSeek(percent * duration);
        }}
      >
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: '#1db954',
          transition: 'width 0.1s linear',
        }} />
      </div>

      <Focusable style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}>
        {/* 封面和歌曲信息 */}
        <div 
          onClick={onClick}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flex: 1,
            overflow: 'hidden',
            cursor: 'pointer',
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
            }}
            onError={(e) => {
              (e.target as HTMLImageElement).src = getDefaultCover(44);
            }}
          />
          <div style={{ overflow: 'hidden', minWidth: 0 }}>
            <div style={{ 
              fontSize: '14px', 
              fontWeight: 500,
              color: '#fff',
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
            }}>
              {song.singer}
            </div>
          </div>
        </div>

        {/* 时间显示 */}
        <div style={{ 
          fontSize: '11px', 
          color: '#8b929a',
          flexShrink: 0,
        }}>
          {formatDuration(Math.floor(currentTime))} / {formatDuration(duration)}
        </div>

        {/* 播放控制 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div 
            onClick={(e) => {
              e.stopPropagation();
              onSeek(Math.max(0, currentTime - 10));
            }}
            style={{ 
              cursor: 'pointer',
              padding: '8px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)',
            }}
          >
            <FaStepBackward size={14} />
          </div>
          
          <div 
            onClick={(e) => {
              e.stopPropagation();
              onTogglePlay();
            }}
            style={{ 
              cursor: loading ? 'wait' : 'pointer',
              padding: '10px',
              borderRadius: '50%',
              background: '#1db954',
              color: '#fff',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {isPlaying ? <FaPause size={16} /> : <FaPlay size={16} style={{ marginLeft: '2px' }} />}
          </div>
          
          <div 
            onClick={(e) => {
              e.stopPropagation();
              onSeek(Math.min(duration, currentTime + 10));
            }}
            style={{ 
              cursor: 'pointer',
              padding: '8px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)',
            }}
          >
            <FaStepForward size={14} />
          </div>
        </div>
      </Focusable>
    </div>
  );
};


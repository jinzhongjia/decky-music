/**
 * 迷你播放器组件 - 底部播放条
 * 所有按钮都支持手柄操作
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
  onNext?: () => void;
  onPrev?: () => void;
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
  onNext,
  onPrev,
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
      <Focusable
        onActivate={() => {
          // 手柄按A键时跳到中间位置
          if (duration > 0) onSeek(duration / 2);
        }}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '6px',
          background: 'rgba(255,255,255,0.1)',
          cursor: duration > 0 ? 'pointer' : 'default',
        }}
        onClick={(e) => {
          if (duration <= 0) return;
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
          pointerEvents: 'none',
        }} />
      </Focusable>

      <Focusable style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginTop: '2px',
      }}>
        {/* 封面和歌曲信息 - 可聚焦点击进入播放器 */}
        <Focusable
          onActivate={onClick}
          onClick={onClick}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flex: 1,
            overflow: 'hidden',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '8px',
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
          <div style={{ overflow: 'hidden', minWidth: 0, flex: 1 }}>
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
              {song.singer} · {formatDuration(Math.floor(currentTime))} / {formatDuration(duration)}
            </div>
          </div>
        </Focusable>

        {/* 播放控制按钮 */}
        <Focusable style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* 上一首/后退按钮 */}
          <Focusable
            onActivate={() => onPrev ? onPrev() : onSeek(Math.max(0, currentTime - 10))}
            onClick={(e) => {
              e.stopPropagation();
              onPrev ? onPrev() : onSeek(Math.max(0, currentTime - 10));
            }}
            style={{ 
              cursor: 'pointer',
              padding: '10px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <FaStepBackward size={14} />
          </Focusable>
          
          {/* 播放/暂停按钮 */}
          <Focusable
            onActivate={onTogglePlay}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePlay();
            }}
            style={{ 
              cursor: loading ? 'wait' : 'pointer',
              padding: '12px',
              borderRadius: '50%',
              background: '#1db954',
              color: '#fff',
              opacity: loading ? 0.7 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {isPlaying ? <FaPause size={16} /> : <FaPlay size={16} style={{ marginLeft: '2px' }} />}
          </Focusable>
          
          {/* 下一首/快进按钮 */}
          <Focusable
            onActivate={() => onNext ? onNext() : onSeek(Math.min(duration, currentTime + 10))}
            onClick={(e) => {
              e.stopPropagation();
              onNext ? onNext() : onSeek(Math.min(duration, currentTime + 10));
            }}
            style={{ 
              cursor: 'pointer',
              padding: '10px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <FaStepForward size={14} />
          </Focusable>
        </Focusable>
      </Focusable>
    </div>
  );
};

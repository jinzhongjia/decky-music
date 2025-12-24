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
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 100,  // 确保播放器条在其他内容之上
      background: 'linear-gradient(to top, rgba(20, 20, 20, 0.98), rgba(30, 30, 30, 0.95))',
      borderTop: '1px solid rgba(255,255,255,0.1)',
      padding: '8px 12px',
      backdropFilter: 'blur(10px)',
    }}>
      {/* 进度条（仅显示，不可聚焦） */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '6px',
          background: 'rgba(255,255,255,0.1)',
        }}
      >
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: '#1db954',
          transition: 'width 0.1s linear',
        }} />
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginTop: '2px',
      }}>
        {/* 封面和歌曲信息 - 可聚焦点击进入播放器 */}
        <Focusable
          focusClassName="qqmusic-control-btn-focused"
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* 上一首/后退按钮 */}
          <Focusable
            focusClassName="qqmusic-control-btn-focused"
            onActivate={() => onPrev ? onPrev() : onSeek(Math.max(0, currentTime - 10))}
            onClick={(e) => {
              e.stopPropagation();
              onPrev ? onPrev() : onSeek(Math.max(0, currentTime - 10));
            }}
            style={{ 
              cursor: 'pointer',
              width: '34px',
              height: '34px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <FaStepBackward size={14} />
          </Focusable>
          
          {/* 播放/暂停按钮 */}
          <Focusable
            focusClassName="qqmusic-play-btn-focused"
            onActivate={onTogglePlay}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePlay();
            }}
            style={{ 
              cursor: loading ? 'wait' : 'pointer',
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: '#1db954',
              color: '#fff',
              opacity: loading ? 0.7 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {isPlaying ? <FaPause size={16} /> : <FaPlay size={16} style={{ marginLeft: '2px' }} />}
          </Focusable>
          
          {/* 下一首/快进按钮 */}
          <Focusable
            focusClassName="qqmusic-control-btn-focused"
            onActivate={() => onNext ? onNext() : onSeek(Math.min(duration, currentTime + 10))}
            onClick={(e) => {
              e.stopPropagation();
              onNext ? onNext() : onSeek(Math.min(duration, currentTime + 10));
            }}
            style={{ 
              cursor: 'pointer',
              width: '34px',
              height: '34px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <FaStepForward size={14} />
          </Focusable>
        </div>
      </div>
    </div>
  );
};

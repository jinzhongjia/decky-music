/**
 * 迷你播放器组件 - 底部播放条
 * 不可获取焦点，只响应点击
 */

import { FC } from "react";
import { FaPlay, FaPause, FaStepForward, FaStepBackward } from "react-icons/fa";
import type { SongInfo } from "../types";
import { formatDuration } from "../utils/format";
import { SafeImage } from "./SafeImage";

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
        {/* 封面和歌曲信息 - 点击进入播放器详情页 */}
        <div
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
          <SafeImage 
            src={song.cover}
            alt={song.name}
            size={44}
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '6px',
              objectFit: 'cover',
              background: '#2a2a2a',
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
        </div>

        {/* 播放控制按钮 - 只响应点击，不可聚焦 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* 上一首/后退按钮 */}
          <div
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
          </div>
          
          {/* 播放/暂停按钮 */}
          <div
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
          </div>
          
          {/* 下一首/快进按钮 */}
          <div
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
          </div>
        </div>
      </div>
    </div>
  );
};

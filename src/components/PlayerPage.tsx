/**
 * 全屏播放器页面
 * 用方向键导航到控制按钮，按A键激活
 */

import { FC } from "react";
import { PanelSection, PanelSectionRow, Spinner, Focusable } from "@decky/ui";
import { FaPlay, FaPause, FaStepForward, FaStepBackward } from "react-icons/fa";
import type { SongInfo } from "../types";
import { formatDuration, getDefaultCover } from "../utils/format";

interface PlayerPageProps {
  song: SongInfo;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  loading: boolean;
  error: string;
  hasPlaylist?: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onNext?: () => void;
  onPrev?: () => void;
  onBack?: () => void;  // 保留接口兼容性，但不再使用
}

export const PlayerPage: FC<PlayerPageProps> = ({
  song,
  isPlaying,
  currentTime,
  duration,
  loading,
  error,
  hasPlaylist = false,
  onTogglePlay,
  onSeek,
  onNext,
  onPrev,
  onBack: _onBack,  // eslint-disable-line @typescript-eslint/no-unused-vars
}) => {
  const actualDuration = duration > 0 ? duration : song.duration;
  const progress = actualDuration > 0 ? (currentTime / actualDuration) * 100 : 0;

  const handlePrev = () => {
    if (hasPlaylist && onPrev) {
      onPrev();
    } else {
      onSeek(Math.max(0, currentTime - 15));
    }
  };

  const handleNext = () => {
    if (hasPlaylist && onNext) {
      onNext();
    } else {
      onSeek(Math.min(actualDuration, currentTime + 15));
    }
  };

  return (
    <PanelSection title="🎵 正在播放">
      {/* 封面 */}
      <PanelSectionRow>
        <div style={{ textAlign: 'center', padding: '15px' }}>
          <img 
            src={song.cover}
            alt={song.name}
            style={{
              width: '180px',
              height: '180px',
              borderRadius: '12px',
              objectFit: 'cover',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              animation: isPlaying ? 'spin 12s linear infinite' : 'none',
            }}
            onError={(e) => {
              (e.target as HTMLImageElement).src = getDefaultCover(180);
            }}
          />
        </div>
      </PanelSectionRow>

      {/* 歌曲信息 */}
      <PanelSectionRow>
        <div style={{ textAlign: 'center', padding: '5px 0' }}>
          <div style={{ 
            fontSize: '18px', 
            fontWeight: 600,
            color: '#fff',
            marginBottom: '6px',
          }}>
            {song.name}
          </div>
          <div style={{ 
            fontSize: '14px', 
            color: '#8b929a',
          }}>
            {song.singer}{song.album ? ` · ${song.album}` : ''}
          </div>
        </div>
      </PanelSectionRow>

      {/* 错误提示 */}
      {error && (
        <PanelSectionRow>
          <Focusable
            noFocusRing={!hasPlaylist}
            onActivate={hasPlaylist && onNext ? onNext : undefined}
            onClick={hasPlaylist && onNext ? onNext : undefined}
            style={{ 
              textAlign: 'center', 
              color: '#ff6b6b',
              fontSize: '13px',
              padding: '12px',
              background: 'rgba(255, 107, 107, 0.1)',
              borderRadius: '8px',
              cursor: hasPlaylist ? 'pointer' : 'default',
            }}
          >
            <div style={{ marginBottom: '6px' }}>⚠️ {error}</div>
            {hasPlaylist && (
              <div style={{ fontSize: '12px', color: '#8b929a' }}>
                点击跳过或等待自动播放下一首
              </div>
            )}
          </Focusable>
        </PanelSectionRow>
      )}

      {/* 加载中 */}
      {loading && (
        <PanelSectionRow>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
            <Spinner />
          </div>
        </PanelSectionRow>
      )}

      {/* 播放控制 */}
      {!loading && !error && (
        <>
          {/* 进度条 */}
          <PanelSectionRow>
            <div style={{ padding: '10px 0' }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between',
                fontSize: '12px',
                color: '#8b929a',
                marginBottom: '8px',
              }}>
                <span>{formatDuration(Math.floor(currentTime))}</span>
                <span>{formatDuration(actualDuration)}</span>
              </div>
              <Focusable 
                onActivate={() => {
                  // 手柄按A键跳到中间
                  if (actualDuration > 0) onSeek(actualDuration / 2);
                }}
                style={{
                  height: '8px',
                  background: 'rgba(255,255,255,0.15)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  cursor: actualDuration > 0 ? 'pointer' : 'default',
                }}
                onClick={(e) => {
                  if (actualDuration <= 0) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const percent = (e.clientX - rect.left) / rect.width;
                  onSeek(percent * actualDuration);
                }}
              >
                <div style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: 'linear-gradient(90deg, #1db954, #1ed760)',
                  borderRadius: '4px',
                  transition: 'width 0.1s linear',
                  pointerEvents: 'none',
                }} />
              </Focusable>
            </div>
          </PanelSectionRow>

          {/* 控制按钮 - 使用 Focusable 支持手柄 */}
          <PanelSectionRow>
            <Focusable style={{ 
              display: 'flex', 
              justifyContent: 'center', 
              alignItems: 'center',
              gap: '24px',
              padding: '15px 0',
            }}>
              {/* 上一首按钮 */}
              <Focusable
                onActivate={handlePrev}
                onClick={handlePrev}
                style={{ 
                  cursor: 'pointer',
                  width: '52px',
                  height: '52px',
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <FaStepBackward size={20} />
              </Focusable>
              
              {/* 播放/暂停按钮 */}
              <Focusable
                onActivate={onTogglePlay}
                onClick={onTogglePlay}
                style={{ 
                  cursor: 'pointer',
                  width: '68px',
                  height: '68px',
                  borderRadius: '50%',
                  background: '#1db954',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 16px rgba(29, 185, 84, 0.4)',
                  flexShrink: 0,
                }}
              >
                {isPlaying ? <FaPause size={28} /> : <FaPlay size={28} style={{ marginLeft: '4px' }} />}
              </Focusable>
              
              {/* 下一首按钮 */}
              <Focusable
                onActivate={handleNext}
                onClick={handleNext}
                style={{ 
                  cursor: 'pointer',
                  width: '52px',
                  height: '52px',
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <FaStepForward size={20} />
              </Focusable>
            </Focusable>
          </PanelSectionRow>

          {/* 操作提示 */}
          <PanelSectionRow>
            <div style={{ 
              textAlign: 'center', 
              fontSize: '11px', 
              color: '#8b929a',
              padding: '8px 0',
            }}>
              🎮 方向键选择 · A键确认 · B键返回
            </div>
          </PanelSectionRow>
        </>
      )}
    </PanelSection>
  );
};

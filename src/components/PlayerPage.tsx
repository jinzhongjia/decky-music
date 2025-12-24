/**
 * 全屏播放器页面
 */

import { FC } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, Spinner, Focusable } from "@decky/ui";
import { FaPlay, FaPause, FaStepForward, FaStepBackward, FaArrowLeft } from "react-icons/fa";
import type { SongInfo } from "../types";
import { formatDuration, getDefaultCover } from "../utils/format";

interface PlayerPageProps {
  song: SongInfo;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  loading: boolean;
  error: string;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onBack: () => void;
}

export const PlayerPage: FC<PlayerPageProps> = ({
  song,
  isPlaying,
  currentTime,
  duration,
  loading,
  error,
  onTogglePlay,
  onSeek,
  onBack,
}) => {
  const actualDuration = duration > 0 ? duration : song.duration;
  const progress = actualDuration > 0 ? (currentTime / actualDuration) * 100 : 0;

  return (
    <PanelSection title="🎵 正在播放">
      {/* 返回按钮 */}
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={onBack}>
          <FaArrowLeft style={{ marginRight: '8px' }} />
          返回
        </ButtonItem>
      </PanelSectionRow>

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
          <div style={{ 
            textAlign: 'center', 
            color: '#ff6b6b',
            fontSize: '13px',
            padding: '10px',
            background: 'rgba(255, 107, 107, 0.1)',
            borderRadius: '8px',
          }}>
            {error}
          </div>
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
              <div 
                style={{
                  height: '6px',
                  background: 'rgba(255,255,255,0.15)',
                  borderRadius: '3px',
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
                  borderRadius: '3px',
                  transition: 'width 0.1s linear',
                }} />
              </div>
            </div>
          </PanelSectionRow>

          {/* 控制按钮 */}
          <PanelSectionRow>
            <Focusable style={{ 
              display: 'flex', 
              justifyContent: 'center', 
              gap: '24px',
              padding: '15px 0',
            }}>
              <div 
                onClick={() => onSeek(Math.max(0, currentTime - 15))}
                style={{ 
                  cursor: 'pointer',
                  padding: '14px',
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <FaStepBackward size={18} />
              </div>
              
              <div 
                onClick={onTogglePlay}
                style={{ 
                  cursor: 'pointer',
                  padding: '18px',
                  borderRadius: '50%',
                  background: '#1db954',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 16px rgba(29, 185, 84, 0.4)',
                }}
              >
                {isPlaying ? <FaPause size={24} /> : <FaPlay size={24} style={{ marginLeft: '3px' }} />}
              </div>
              
              <div 
                onClick={() => onSeek(Math.min(actualDuration, currentTime + 15))}
                style={{ 
                  cursor: 'pointer',
                  padding: '14px',
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <FaStepForward size={18} />
              </div>
            </Focusable>
          </PanelSectionRow>
        </>
      )}
    </PanelSection>
  );
};


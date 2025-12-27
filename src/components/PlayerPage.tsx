/**
 * 全屏播放器页面
 * 用方向键导航到控制按钮，按A键激活
 */

import { FC, useMemo } from "react";
import { PanelSection, PanelSectionRow, Focusable } from "@decky/ui";
import { FaListOl, FaPlay, FaPause, FaRandom, FaRedo, FaStepForward, FaStepBackward } from "react-icons/fa";
import type { PlayMode, SongInfo } from "../types";
import { formatDuration } from "../utils/format";
import { BackButton } from "./BackButton";
import { LoadingSpinner } from "./LoadingSpinner";
import { SafeImage } from "./SafeImage";
import { FLEX_CENTER, COLORS } from "../utils/styles";

interface PlayerPageProps {
  song: SongInfo;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  loading: boolean;
  error: string;
  hasPlaylist?: boolean;
  playMode: PlayMode;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onNext?: () => void;
  onPrev?: () => void;
  onTogglePlayMode: () => void;
  onBack: () => void;
}

export const PlayerPage: FC<PlayerPageProps> = ({
  song,
  isPlaying,
  currentTime,
  duration,
  loading,
  error,
  hasPlaylist = false,
  playMode,
  onTogglePlay,
  onSeek,
  onNext,
  onPrev,
  onTogglePlayMode,
  onBack,
}) => {
  const actualDuration = duration > 0 ? duration : song.duration;
  const progress = actualDuration > 0 ? (currentTime / actualDuration) * 100 : 0;
  const modeConfig = useMemo(() => {
    switch (playMode) {
      case "shuffle":
        return { icon: <FaRandom size={18} />, label: "随机播放" };
      case "single":
        return { icon: <FaRedo size={18} />, label: "单曲循环" };
      default:
        return { icon: <FaListOl size={18} />, label: "顺序播放" };
    }
  }, [playMode]);

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
      <BackButton onClick={onBack} />

      {/* 封面 */}
      <PanelSectionRow>
        <div style={{ textAlign: 'center', padding: '15px' }}>
          <SafeImage 
            src={song.cover}
            alt={song.name}
            size={180}
            style={{
              width: '180px',
              height: '180px',
              borderRadius: '12px',
              objectFit: 'cover',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              animation: isPlaying ? 'spin 12s linear infinite' : 'none',
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
            color: COLORS.textPrimary,
            marginBottom: '6px',
          }}>
            {song.name}
          </div>
          <div style={{ 
            fontSize: '14px', 
            color: COLORS.textSecondary,
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
              color: COLORS.error,
              fontSize: '13px',
              padding: '12px',
              background: COLORS.errorBg,
              borderRadius: '8px',
              cursor: hasPlaylist ? 'pointer' : 'default',
            }}
          >
            <div style={{ marginBottom: '6px' }}>⚠️ {error}</div>
            {hasPlaylist && (
              <div style={{ fontSize: '12px', color: COLORS.textSecondary }}>
                点击跳过或等待自动播放下一首
              </div>
            )}
          </Focusable>
        </PanelSectionRow>
      )}

      {/* 加载中 */}
      {loading && <LoadingSpinner padding={20} />}

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
                color: COLORS.textSecondary,
                marginBottom: '8px',
              }}>
                <span>{formatDuration(Math.floor(currentTime))}</span>
                <span>{formatDuration(actualDuration)}</span>
              </div>
              <div
                style={{
                  height: '8px',
                  background: COLORS.backgroundDarker,
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                <div style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: `linear-gradient(90deg, ${COLORS.primary}, ${COLORS.primaryLight})`,
                  borderRadius: '4px',
                  transition: 'width 0.1s linear',
                }} />
              </div>
            </div>
          </PanelSectionRow>

          {/* 控制按钮 */}
          <PanelSectionRow>
            <div style={{ 
              ...FLEX_CENTER,
              gap: '16px',
              padding: '15px 0',
            }}>
              {/* 播放模式 */}
              <div
                onClick={onTogglePlayMode}
                title={modeConfig.label}
                style={{
                  width: '46px',
                  height: '46px',
                  borderRadius: '50%',
                  background: COLORS.backgroundDark,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: COLORS.textSecondary,
                }}
              >
                {modeConfig.icon}
              </div>

              {/* 上一首按钮 */}
              <div
                onClick={handlePrev}
                style={{ 
                  width: '52px',
                  height: '52px',
                  borderRadius: '50%',
                  background: COLORS.backgroundDark,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <FaStepBackward size={20} />
              </div>
              
              {/* 播放/暂停按钮 */}
              <div
                onClick={onTogglePlay}
                style={{ 
                  width: '68px',
                  height: '68px',
                  borderRadius: '50%',
                  background: COLORS.primary,
                  color: COLORS.textPrimary,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: `0 4px 16px ${COLORS.primaryShadow}`,
                  cursor: 'pointer',
                }}
              >
                {isPlaying ? <FaPause size={28} /> : <FaPlay size={28} style={{ marginLeft: '4px' }} />}
              </div>
              
              {/* 下一首按钮 */}
              <div
                onClick={handleNext}
                style={{ 
                  width: '52px',
                  height: '52px',
                  borderRadius: '50%',
                  background: COLORS.backgroundDark,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <FaStepForward size={20} />
              </div>
            </div>
          </PanelSectionRow>

          {/* 快捷键说明 */}
          <PanelSectionRow>
            <div style={{
              textAlign: 'center',
              fontSize: '12px',
              color: COLORS.textSecondary,
              padding: '8px 0',
            }}>
              <span style={{ marginRight: '16px' }}>L1 上一首</span>
              <span style={{ marginRight: '16px' }}>X 暂停/继续</span>
              <span>R1 下一首</span>
            </div>
          </PanelSectionRow>
        </>
      )}
    </PanelSection>
  );
};

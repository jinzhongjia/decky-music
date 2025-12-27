/**
 * 全屏播放器页面
 * 用方向键导航到控制按钮，按A键激活
 */
/* global HTMLDivElement */

import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
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
  volume: number;
  loading: boolean;
  error: string;
  hasPlaylist?: boolean;
  playMode: PlayMode;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (volume: number, options?: { commit?: boolean }) => void;
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
  volume,
  onVolumeChange,
}) => {
  const actualDuration = duration > 0 ? duration : song.duration;
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const [dragTime, setDragTime] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const activePointerRef = useRef<number | null>(null);
  const pendingDragTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const volumeBarRef = useRef<HTMLDivElement | null>(null);
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);
  const [isVolumeDragging, setIsVolumeDragging] = useState(false);
  const volumePointerRef = useRef<number | null>(null);
  const pendingVolumeRef = useRef<number | null>(null);
  const volumeRafRef = useRef<number | null>(null);

  const getTimeFromClientX = useCallback(
    (clientX: number) => {
      if (!actualDuration || !progressBarRef.current) return null;
      const rect = progressBarRef.current.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      const clamped = Math.min(1, Math.max(0, ratio));
      return clamped * actualDuration;
    },
    [actualDuration]
  );

  const updateDrag = useCallback(
    (clientX: number) => {
      const nextTime = getTimeFromClientX(clientX);
      if (nextTime === null) return;
      pendingDragTimeRef.current = nextTime;
      if (rafRef.current === null) {
        rafRef.current = window.requestAnimationFrame(() => {
          rafRef.current = null;
          if (pendingDragTimeRef.current !== null) {
            setDragTime(pendingDragTimeRef.current);
          }
        });
      }
    },
    [getTimeFromClientX]
  );

  const endDrag = useCallback(
    (clientX?: number) => {
      if (clientX !== undefined) {
        const finalTime = getTimeFromClientX(clientX);
        if (finalTime !== null) {
          onSeek(finalTime);
        }
      }
      setIsDragging(false);
      setDragTime(null);
      activePointerRef.current = null;
      pendingDragTimeRef.current = null;
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    },
    [getTimeFromClientX, onSeek]
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!actualDuration) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (!progressBarRef.current) return;

      activePointerRef.current = event.pointerId;
      progressBarRef.current.setPointerCapture(event.pointerId);
      setIsDragging(true);
      updateDrag(event.clientX);
    },
    [actualDuration, updateDrag]
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isDragging || event.pointerId !== activePointerRef.current) return;
      updateDrag(event.clientX);
    },
    [isDragging, updateDrag]
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerId !== activePointerRef.current) return;
      if (progressBarRef.current?.hasPointerCapture(event.pointerId)) {
        progressBarRef.current.releasePointerCapture(event.pointerId);
      }
      endDrag(event.clientX);
    },
    [endDrag]
  );

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (volumeRafRef.current !== null) {
        window.cancelAnimationFrame(volumeRafRef.current);
        volumeRafRef.current = null;
      }
    };
  }, []);

  const displayTime = dragTime ?? currentTime;
  const progress =
    actualDuration > 0 ? Math.min(100, Math.max(0, (displayTime / actualDuration) * 100)) : 0;
  const displayVolume = volumeDraft ?? volume;
  const volumePercent = Math.round(displayVolume * 100);
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

  const getVolumeFromClientX = useCallback(
    (clientX: number) => {
      if (!volumeBarRef.current) return null;
      const rect = volumeBarRef.current.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      return Math.min(1, Math.max(0, ratio));
    },
    []
  );

  const updateVolumeDrag = useCallback(
    (clientX: number, immediate?: boolean) => {
      const next = getVolumeFromClientX(clientX);
      if (next === null) return;
      pendingVolumeRef.current = next;
      if (immediate) {
        setVolumeDraft(next);
        onVolumeChange(next);
        return;
      }
      if (volumeRafRef.current === null) {
        volumeRafRef.current = window.requestAnimationFrame(() => {
          volumeRafRef.current = null;
          if (pendingVolumeRef.current !== null) {
            const value = pendingVolumeRef.current;
            setVolumeDraft(value);
            onVolumeChange(value);
          }
        });
      }
    },
    [getVolumeFromClientX, onVolumeChange]
  );

  const finishVolumeDrag = useCallback(
    (clientX?: number) => {
      let finalVolume: number | null = null;
      if (clientX !== undefined) {
        finalVolume = getVolumeFromClientX(clientX);
      } else if (volumeDraft !== null) {
        finalVolume = volumeDraft;
      }
      if (finalVolume !== null) {
        onVolumeChange(finalVolume, { commit: true });
      }
      setIsVolumeDragging(false);
      setVolumeDraft(null);
      volumePointerRef.current = null;
      pendingVolumeRef.current = null;
      if (volumeRafRef.current !== null) {
        window.cancelAnimationFrame(volumeRafRef.current);
        volumeRafRef.current = null;
      }
    },
    [getVolumeFromClientX, onVolumeChange, volumeDraft]
  );

  const handleVolumePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (!volumeBarRef.current) return;
      volumePointerRef.current = event.pointerId;
      volumeBarRef.current.setPointerCapture(event.pointerId);
      setIsVolumeDragging(true);
      updateVolumeDrag(event.clientX, true);
    },
    [updateVolumeDrag]
  );

  const handleVolumePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isVolumeDragging || event.pointerId !== volumePointerRef.current) return;
      updateVolumeDrag(event.clientX);
    },
    [isVolumeDragging, updateVolumeDrag]
  );

  const handleVolumePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerId !== volumePointerRef.current) return;
      if (volumeBarRef.current?.hasPointerCapture(event.pointerId)) {
        volumeBarRef.current.releasePointerCapture(event.pointerId);
      }
      finishVolumeDrag(event.clientX);
    },
    [finishVolumeDrag]
  );

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
                <span>{formatDuration(Math.floor(displayTime))}</span>
                <span>{formatDuration(actualDuration)}</span>
              </div>
              <div
                style={{
                  height: '12px',
                  background: COLORS.backgroundDarker,
                  borderRadius: '6px',
                  overflow: 'hidden',
                  position: 'relative',
                  cursor: actualDuration ? 'pointer' : 'default',
                  touchAction: 'none',
                }}
                ref={progressBarRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              >
                <div style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: `linear-gradient(90deg, ${COLORS.primary}, ${COLORS.primaryLight})`,
                  borderRadius: '4px',
                  transition: isDragging ? 'none' : 'width 0.1s linear',
                }} />
              </div>
            </div>
          </PanelSectionRow>

          {/* 音量控制 */}
          <PanelSectionRow>
            <div style={{ padding: '4px 0' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '12px',
                  color: COLORS.textSecondary,
                  marginBottom: '6px',
                }}
              >
                <span>音量</span>
                <span>{volumePercent}%</span>
              </div>
              <div
                ref={volumeBarRef}
                onPointerDown={handleVolumePointerDown}
                onPointerMove={handleVolumePointerMove}
                onPointerUp={handleVolumePointerUp}
                onPointerCancel={handleVolumePointerUp}
                style={{
                  height: '12px',
                  background: COLORS.backgroundDarker,
                  borderRadius: '6px',
                  overflow: 'hidden',
                  position: 'relative',
                  cursor: 'pointer',
                  touchAction: 'none',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${volumePercent}%`,
                    background: `linear-gradient(90deg, ${COLORS.primary}, ${COLORS.primaryLight})`,
                    borderRadius: '6px',
                    transition: isVolumeDragging ? 'none' : 'width 0.1s linear',
                  }}
                />
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

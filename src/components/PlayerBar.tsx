/**
 * 迷你播放器组件 - 底部播放条
 * 不可获取焦点，只响应点击
 */

/* global HTMLDivElement */

import React, { FC, useCallback, useMemo, useRef, useState } from "react";
import { FaPlay, FaPause, FaStepForward, FaStepBackward, FaRandom, FaRedo, FaListOl } from "react-icons/fa";
import type { PlayMode, SongInfo } from "../types";
import { formatDuration } from "../utils/format";
import { SafeImage } from "./SafeImage";
import { TEXT_ELLIPSIS, TEXT_CONTAINER, FLEX_CENTER, COLORS } from "../utils/styles";

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
  playMode?: PlayMode;
  onTogglePlayMode?: () => void;
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
  playMode,
  onTogglePlayMode,
}) => {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [dragTime, setDragTime] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const draggingIdRef = useRef<number | null>(null);
  const pendingDragTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const getTimeFromClientX = useCallback(
    (clientX: number) => {
      if (!duration || !barRef.current) return null;
      const rect = barRef.current.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      const clamped = Math.min(1, Math.max(0, ratio));
      return clamped * duration;
    },
    [duration]
  );

  const handleSeek = useCallback(
    (clientX: number) => {
      const next = getTimeFromClientX(clientX);
      if (next === null) return;
      pendingDragTimeRef.current = next;
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

  const commitSeek = useCallback(
    (clientX?: number) => {
      if (clientX !== undefined) {
        const final = getTimeFromClientX(clientX);
        if (final !== null) {
          onSeek(final);
          setDragTime(final);
        }
      }
      setIsDragging(false);
      draggingIdRef.current = null;
      pendingDragTimeRef.current = null;
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    },
    [getTimeFromClientX, onSeek]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!duration) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      draggingIdRef.current = event.pointerId;
      barRef.current?.setPointerCapture(event.pointerId);
      setIsDragging(true);
      handleSeek(event.clientX);
    },
    [duration, handleSeek]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging || event.pointerId !== draggingIdRef.current) return;
      handleSeek(event.clientX);
    },
    [handleSeek, isDragging]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerId !== draggingIdRef.current) return;
      if (barRef.current?.hasPointerCapture(event.pointerId)) {
        barRef.current.releasePointerCapture(event.pointerId);
      }
      commitSeek(event.clientX);
    },
    [commitSeek]
  );

  const displayTime = dragTime ?? currentTime;
  const progress = useMemo(
    () => (duration > 0 ? Math.min(100, Math.max(0, (displayTime / duration) * 100)) : 0),
    [displayTime, duration]
  );

  React.useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const modeConfig = useMemo(() => {
    if (!playMode) return null;
    switch (playMode) {
      case "shuffle":
        return { icon: <FaRandom size={14} />, title: "随机播放" };
      case "single":
        return { icon: <FaRedo size={14} />, title: "单曲循环" };
      default:
        return { icon: <FaListOl size={14} />, title: "顺序播放" };
    }
  }, [playMode]);

  // 使用 ref 追踪最新值，避免 callback 依赖变化导致子组件重渲染
  const currentTimeRef = React.useRef(currentTime);
  const durationRef = React.useRef(duration);

  React.useEffect(() => {
    currentTimeRef.current = currentTime;
    durationRef.current = duration;
  }, [currentTime, duration]);

  const handlePrevClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onPrev ? onPrev() : onSeek(Math.max(0, currentTimeRef.current - 10));
    },
    [onPrev, onSeek]
  );

  const handlePlayPauseClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onTogglePlay();
    },
    [onTogglePlay]
  );

  const handleNextClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onNext ? onNext() : onSeek(Math.min(durationRef.current, currentTimeRef.current + 10));
    },
    [onNext, onSeek]
  );

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100, // 确保播放器条在其他内容之上
        background: "linear-gradient(to top, rgba(20, 20, 20, 0.98), rgba(30, 30, 30, 0.95))",
        borderTop: `1px solid ${COLORS.borderLight}`,
        padding: "8px 12px",
        backdropFilter: "blur(10px)",
      }}
    >
      {/* 进度条（仅显示，不可聚焦） */}
      <div
        ref={barRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "10px",
          background: COLORS.backgroundDark,
          touchAction: "none",
          cursor: "pointer",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progress}%`,
            background: COLORS.primary,
            transition: isDragging ? "none" : "width 0.1s linear",
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          marginTop: "2px",
        }}
      >
        {/* 封面和歌曲信息 - 点击进入播放器详情页 */}
        <div
          onClick={onClick}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flex: 1,
            overflow: "hidden",
            cursor: "pointer",
            padding: "4px",
            borderRadius: "8px",
          }}
        >
          <SafeImage
            src={song.cover}
            alt={song.name}
            size={44}
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "6px",
              objectFit: "cover",
              background: COLORS.backgroundDarkBase,
            }}
          />
          <div style={TEXT_CONTAINER}>
            <div
              style={{
                fontSize: "14px",
                fontWeight: 500,
                color: COLORS.textPrimary,
                ...TEXT_ELLIPSIS,
              }}
            >
              {song.name}
            </div>
            <div
              style={{
                fontSize: "12px",
                color: COLORS.textSecondary,
                ...TEXT_ELLIPSIS,
              }}
            >
              {song.singer} · {formatDuration(Math.floor(currentTime))} / {formatDuration(duration)}
            </div>
          </div>
        </div>

        {/* 播放控制按钮 */}
        <PlayerControls
          isPlaying={isPlaying}
          loading={loading}
          onPrevClick={handlePrevClick}
          onPlayPauseClick={handlePlayPauseClick}
          onNextClick={handleNextClick}
          modeConfig={modeConfig || undefined}
          onModeClick={onTogglePlayMode}
        />
      </div>
    </div>
  );
};

// 抽离控制按钮组件并 memo 化
const PlayerControls = React.memo<{
  isPlaying: boolean;
  loading: boolean;
  onPrevClick: (e: React.MouseEvent) => void;
  onPlayPauseClick: (e: React.MouseEvent) => void;
  onNextClick: (e: React.MouseEvent) => void;
  modeConfig?: { icon: React.ReactNode; title: string };
  onModeClick?: (e: React.MouseEvent) => void;
}>(({ isPlaying, loading, onPrevClick, onPlayPauseClick, onNextClick, modeConfig, onModeClick }) => {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      {/* 播放模式切换 */}
      <div
        onClick={onModeClick}
        title={modeConfig?.title}
        style={{
          cursor: onModeClick ? "pointer" : "default",
          width: "30px",
          height: "30px",
          borderRadius: "50%",
          background: COLORS.backgroundDark,
          ...FLEX_CENTER,
          flexShrink: 0,
          opacity: modeConfig ? 1 : 0.6,
        }}
      >
        {modeConfig?.icon}
      </div>

      {/* 上一首/后退按钮 */}
      <div
        onClick={onPrevClick}
        style={{
          cursor: "pointer",
          width: "34px",
          height: "34px",
          borderRadius: "50%",
          background: COLORS.backgroundDark,
          ...FLEX_CENTER,
          flexShrink: 0,
        }}
      >
        <FaStepBackward size={14} />
      </div>

      {/* 播放/暂停按钮 */}
      <div
        onClick={onPlayPauseClick}
        style={{
          cursor: loading ? "wait" : "pointer",
          width: "40px",
          height: "40px",
          borderRadius: "50%",
          background: COLORS.primary,
          color: COLORS.textPrimary,
          opacity: loading ? 0.7 : 1,
          ...FLEX_CENTER,
          flexShrink: 0,
        }}
      >
        {isPlaying ? <FaPause size={16} /> : <FaPlay size={16} style={{ marginLeft: "2px" }} />}
      </div>

      {/* 下一首/快进按钮 */}
      <div
        onClick={onNextClick}
        style={{
          cursor: "pointer",
          width: "34px",
          height: "34px",
          borderRadius: "50%",
          background: COLORS.backgroundDark,
          ...FLEX_CENTER,
          flexShrink: 0,
        }}
      >
        <FaStepForward size={14} />
      </div>
    </div>
  );
});

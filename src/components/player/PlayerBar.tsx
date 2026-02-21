/**
 * 迷你播放器组件 - 底部播放条
 * 不可获取焦点，只响应点击
 *
 * 使用 useAudioTime hook 获取时间状态，避免高频更新影响父组件
 */



import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaPlay, FaPause, FaStepForward, FaStepBackward, FaRandom, FaRedo, FaListOl } from "react-icons/fa";
import type { PlayMode, SongInfo } from "../../types";
import { formatDuration } from "../../utils/format";
import { SafeImage } from "../common";
import { TEXT_ELLIPSIS, TEXT_CONTAINER, FLEX_CENTER, COLORS } from "../../utils/styles";
import { useSyncAudioProgress, getAudioTime } from "../../features/player";

interface PlayerBarProps {
  song: SongInfo;
  isPlaying: boolean;
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
  loading = false,
  onTogglePlay,
  onSeek,
  onClick,
  onNext,
  onPrev,
  playMode,
  onTogglePlayMode,
}) => {
  // 移除高频重渲染的 useAudioTime，改用 getAudioTime 获取初始值和在事件中获取
  const [duration, setDuration] = useState(() => getAudioTime().duration || song.duration);
  const barRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const timeTextRef = useRef<HTMLSpanElement | null>(null);

  const [dragTime, setDragTime] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const draggingIdRef = useRef<number | null>(null);
  const cachedRectRef = useRef<DOMRect | null>(null);

  useEffect(() => {
    // 当歌曲切换时，重置时长为初始或0，让后续 update 同步最新
    setDuration(song.duration);
  }, [song.mid, song.duration]);

  // Zero React Overhead 进度条动画
  useSyncAudioProgress({
    progressRef,
    textRef: timeTextRef,
    dragTime,
    duration,
  });

  const getTimeFromClientX = useCallback(
    (clientX: number, rect?: DOMRect | null) => {
      const useRect = rect || cachedRectRef.current || barRef.current?.getBoundingClientRect();
      if (!duration || !useRect) return 0; // Fixed return type safety to return 0 instead of falling through
      const ratio = (clientX - useRect.left) / useRect.width;
      const clamped = Math.min(1, Math.max(0, ratio));
      return clamped * duration;
    },
    [duration]
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
      cachedRectRef.current = null;
    },
    [getTimeFromClientX, onSeek]
  );

  // 智能清除：当 audio 追上 seek 目标时自动清除 dragTime
  useEffect(() => {
    if (dragTime !== null && !isDragging) {
      const checkInterval = setInterval(() => {
        const { currentTime } = getAudioTime();
        if (Math.abs(currentTime - dragTime) < 0.5) {
          setDragTime(null);
          clearInterval(checkInterval);
        }
      }, 200);
      return () => clearInterval(checkInterval);
    }
    return undefined;
  }, [dragTime, isDragging]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!duration) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (!barRef.current) return;

      // 缓存 rect 避免拖动过程中频繁重排
      const rect = barRef.current.getBoundingClientRect();
      cachedRectRef.current = rect;

      draggingIdRef.current = event.pointerId;
      barRef.current.setPointerCapture(event.pointerId);
      setIsDragging(true);

      const nextTime = getTimeFromClientX(event.clientX, rect);
      if (nextTime !== null) {
        setDragTime(nextTime);
      }
    },
    [duration, getTimeFromClientX]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging || event.pointerId !== draggingIdRef.current) return;
      const nextTime = getTimeFromClientX(event.clientX);
      if (nextTime !== null) {
        setDragTime(nextTime);
      }
    },
    [isDragging, getTimeFromClientX]
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

  const handlePrevClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const currentNativeTime = getAudioTime().currentTime;
      onPrev ? onPrev() : onSeek(Math.max(0, currentNativeTime - 10));
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
      const currentNativeTime = getAudioTime().currentTime;
      // Note: durationRef.current is not defined here. Assuming 'duration' state should be used.
      onNext ? onNext() : onSeek(Math.min(duration, currentNativeTime + 10));
    },
    [onNext, onSeek, duration] // Added duration to dependencies
  );

  const modeConfig = useMemo(() => {
    switch (playMode) {
      case "shuffle":
        return { icon: <FaRandom size={14} />, title: "随机播放" };
      case "single":
        return { icon: <FaRedo size={14} />, title: "单曲循环" };
      default:
        return { icon: <FaListOl size={14} />, title: "顺序播放" };
    }
  }, [playMode]);

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
          ref={progressRef}
          style={{
            height: "100%",
            width: "0%",
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
              {song.singer} · <span ref={timeTextRef}>0:00</span> / {formatDuration(duration)}
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

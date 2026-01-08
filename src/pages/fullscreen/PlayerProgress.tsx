import { FC, memo, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import { formatDuration } from "../../utils/format";
import { useAudioTime } from "../../features/player";

interface PlayerProgressProps {
  hasSong: boolean;
  songDuration: number;
  onSeek: (time: number) => void;
}

const progressContainerStyle: CSSProperties = {
  width: "100%",
  maxWidth: "240px",
  marginBottom: "12px",
  padding: "6px 0",
};
const progressBarOuterStyle: CSSProperties = {
  width: "100%",
  height: "10px",
  background: "rgba(255,255,255,0.1)",
  borderRadius: "6px",
  overflow: "hidden",
  cursor: "pointer",
  touchAction: "none",
  position: "relative",
};
const progressTimeStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: "10px",
  color: "#666",
  marginTop: "4px",
};
const thumbStyle: CSSProperties = {
  position: "absolute",
  top: "50%",
  width: "14px",
  height: "14px",
  borderRadius: "50%",
  background: "#1db954",
  transform: "translate(-50%, -50%)",
  boxShadow: "0 0 10px rgba(29, 185, 84, 0.55)",
  pointerEvents: "none",
};

export const PlayerProgress: FC<PlayerProgressProps> = memo(
  ({ hasSong, songDuration, onSeek }) => {
    const { currentTime, duration: audioDuration } = useAudioTime({ enabled: hasSong });
    const duration = audioDuration || songDuration;

    const barRef = useRef<HTMLDivElement | null>(null);
    const [dragTime, setDragTime] = useState<number | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const activePointerRef = useRef<number | null>(null);
    // 缓存 rect 避免拖动时频繁调用 getBoundingClientRect 导致重排
    const cachedRectRef = useRef<DOMRect | null>(null);

    const getTimeFromClientX = useCallback(
      (clientX: number, rect?: DOMRect | null) => {
        const useRect = rect || cachedRectRef.current || barRef.current?.getBoundingClientRect();
        if (!duration || !useRect) return null;
        const ratio = (clientX - useRect.left) / useRect.width;
        const clamped = Math.min(1, Math.max(0, ratio));
        return clamped * duration;
      },
      [duration]
    );

    const endDrag = useCallback(
      (clientX?: number) => {
        if (clientX !== undefined) {
          const finalTime = getTimeFromClientX(clientX);
          if (finalTime !== null) {
            onSeek(finalTime);
            setDragTime(finalTime);
          }
        }
        setIsDragging(false);
        activePointerRef.current = null;
        cachedRectRef.current = null;
      },
      [getTimeFromClientX, onSeek]
    );

    // 智能清除：当 audio 追上 seek 目标时自动清除 dragTime
    useEffect(() => {
      if (dragTime !== null && !isDragging) {
        if (Math.abs(currentTime - dragTime) < 0.5) {
          setDragTime(null);
        }
      }
    }, [currentTime, dragTime, isDragging]);

    const handlePointerDown = useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!duration) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (!barRef.current) return;

        // 缓存 rect 避免拖动过程中频繁重排
        const rect = barRef.current.getBoundingClientRect();
        cachedRectRef.current = rect;

        activePointerRef.current = event.pointerId;
        barRef.current.setPointerCapture(event.pointerId);
        setIsDragging(true);

        const initialTime = getTimeFromClientX(event.clientX, rect);
        if (initialTime === null) return;

        setDragTime(initialTime);
        onSeek(initialTime);
      },
      [duration, getTimeFromClientX, onSeek]
    );

    const handlePointerMove = useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.pointerId !== activePointerRef.current) return;
        const nextTime = getTimeFromClientX(event.clientX);
        if (nextTime !== null) {
          setDragTime(nextTime);
        }
      },
      [getTimeFromClientX]
    );

    const handlePointerUp = useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.pointerId !== activePointerRef.current) return;
        if (barRef.current?.hasPointerCapture(event.pointerId)) {
          barRef.current.releasePointerCapture(event.pointerId);
        }
        endDrag(event.clientX);
      },
      [endDrag]
    );

    if (!hasSong) return null;

    const displayTime = dragTime ?? currentTime;
    const percent = duration ? Math.min(100, Math.max(0, (displayTime / duration) * 100)) : 0;

    return (
      <div style={progressContainerStyle}>
        <div
          ref={barRef}
          style={progressBarOuterStyle}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div
            style={{
              width: `${percent}%`,
              height: "100%",
              background: "#1db954",
              borderRadius: "2px",
            }}
          />
          <div
            style={{
              ...thumbStyle,
              left: `${percent}%`,
              opacity: duration ? 1 : 0,
            }}
          />
        </div>
        <div style={progressTimeStyle}>
          <span>{formatDuration(currentTime)}</span>
          <span>{formatDuration(duration)}</span>
        </div>
      </div>
    );
  }
);

PlayerProgress.displayName = "PlayerProgress";
/* global HTMLDivElement */

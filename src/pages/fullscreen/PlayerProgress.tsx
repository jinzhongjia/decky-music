import { FC, memo, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import { formatDuration } from "../../utils/format";
import { usePlayerStore } from "../../stores";

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
    const currentTime = usePlayerStore((s) => s.currentTime);
    const storeDuration = usePlayerStore((s) => s.duration);
    const duration = storeDuration || songDuration;

    const barRef = useRef<HTMLDivElement | null>(null);
    const [dragTime, setDragTime] = useState<number | null>(null);
    const activePointerRef = useRef<number | null>(null);
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
      (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!duration) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (!barRef.current) return;

        activePointerRef.current = event.pointerId;
        barRef.current.setPointerCapture(event.pointerId);

        const initialTime = getTimeFromClientX(event.clientX);
        if (initialTime === null) return;

        setDragTime(initialTime);
        onSeek(initialTime);
      },
      [duration, getTimeFromClientX, onSeek]
    );

    const handlePointerMove = useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.pointerId !== activePointerRef.current) return;
        updateDrag(event.clientX);
      },
      [updateDrag]
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

    useEffect(() => {
      return () => {
        if (rafRef.current !== null) {
          window.cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      };
    }, []);

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

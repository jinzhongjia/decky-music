import { useCallback, useRef, useState } from "react";
import type { PointerEvent } from "react";

interface UseProgressDragOptions {
  duration: number;
  onSeek: (time: number) => void;
}

interface UseProgressDragReturn {
  barRef: React.RefObject<HTMLDivElement | null>;
  dragTime: number | null;
  isDragging: boolean;
  handlePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  handlePointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  handlePointerUp: (event: PointerEvent<HTMLDivElement>) => void;
}

export function useProgressDrag({ duration, onSeek }: UseProgressDragOptions): UseProgressDragReturn {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [dragTime, setDragTime] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const activePointerRef = useRef<number | null>(null);
  const pendingDragTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const getTimeFromClientX = useCallback(
    (clientX: number) => {
      if (!duration || !barRef.current) return null;
      const rect = barRef.current.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      return Math.min(1, Math.max(0, ratio)) * duration;
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
        if (finalTime !== null) onSeek(finalTime);
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
      if (!duration) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (!barRef.current) return;
      activePointerRef.current = event.pointerId;
      barRef.current.setPointerCapture(event.pointerId);
      setIsDragging(true);
      updateDrag(event.clientX);
    },
    [duration, updateDrag]
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
      if (barRef.current?.hasPointerCapture(event.pointerId)) {
        barRef.current.releasePointerCapture(event.pointerId);
      }
      endDrag(event.clientX);
    },
    [endDrag]
  );

  return {
    barRef,
    dragTime,
    isDragging,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  };
}

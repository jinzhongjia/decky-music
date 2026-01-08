import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";

interface UseProgressDragOptions {
  duration: number;
  currentTime: number;
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

/**
 * 进度条拖动 Hook - Spotify 风格
 * - 拖动时立即跟手
 * - 松手后停留在目标位置
 * - audio 追上后自然过渡
 */
export function useProgressDrag({ duration, currentTime, onSeek }: UseProgressDragOptions): UseProgressDragReturn {
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
      return Math.min(1, Math.max(0, ratio)) * duration;
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
    (event: PointerEvent<HTMLDivElement>) => {
      if (!duration) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (!barRef.current) return;

      // 缓存 rect 避免拖动过程中频繁重排
      const rect = barRef.current.getBoundingClientRect();
      cachedRectRef.current = rect;

      activePointerRef.current = event.pointerId;
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
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isDragging || event.pointerId !== activePointerRef.current) return;
      const nextTime = getTimeFromClientX(event.clientX);
      if (nextTime !== null) {
        setDragTime(nextTime);
      }
    },
    [isDragging, getTimeFromClientX]
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

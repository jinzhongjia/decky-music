import { useCallback, useRef, useState } from "react";
import type { PointerEvent } from "react";

interface UseVolumeDragOptions {
  onVolumeChange: (volume: number, options?: { commit?: boolean }) => void;
}

interface UseVolumeDragReturn {
  barRef: React.RefObject<HTMLDivElement | null>;
  volumeDraft: number | null;
  isDragging: boolean;
  handlePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  handlePointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  handlePointerUp: (event: PointerEvent<HTMLDivElement>) => void;
}

export function useVolumeDrag({ onVolumeChange }: UseVolumeDragOptions): UseVolumeDragReturn {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const pointerRef = useRef<number | null>(null);
  const pendingRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const getVolumeFromClientX = useCallback((clientX: number) => {
    if (!barRef.current) return null;
    const rect = barRef.current.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    return Math.min(1, Math.max(0, ratio));
  }, []);

  const updateDrag = useCallback(
    (clientX: number, immediate?: boolean) => {
      const next = getVolumeFromClientX(clientX);
      if (next === null) return;
      pendingRef.current = next;
      if (immediate) {
        setVolumeDraft(next);
        onVolumeChange(next);
        return;
      }
      if (rafRef.current === null) {
        rafRef.current = window.requestAnimationFrame(() => {
          rafRef.current = null;
          if (pendingRef.current !== null) {
            const value = pendingRef.current;
            setVolumeDraft(value);
            onVolumeChange(value);
          }
        });
      }
    },
    [getVolumeFromClientX, onVolumeChange]
  );

  const finishDrag = useCallback(
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
      setIsDragging(false);
      setVolumeDraft(null);
      pointerRef.current = null;
      pendingRef.current = null;
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    },
    [getVolumeFromClientX, onVolumeChange, volumeDraft]
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (!barRef.current) return;
      pointerRef.current = event.pointerId;
      barRef.current.setPointerCapture(event.pointerId);
      setIsDragging(true);
      updateDrag(event.clientX, true);
    },
    [updateDrag]
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isDragging || event.pointerId !== pointerRef.current) return;
      updateDrag(event.clientX);
    },
    [isDragging, updateDrag]
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerId !== pointerRef.current) return;
      if (barRef.current?.hasPointerCapture(event.pointerId)) {
        barRef.current.releasePointerCapture(event.pointerId);
      }
      finishDrag(event.clientX);
    },
    [finishDrag]
  );

  return {
    barRef,
    volumeDraft,
    isDragging,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  };
}

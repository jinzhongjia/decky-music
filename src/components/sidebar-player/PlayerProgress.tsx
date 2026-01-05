import { FC, memo } from "react";
import type { PointerEvent } from "react";
import { PanelSectionRow } from "@decky/ui";
import { formatDuration } from "../../utils/format";
import { COLORS } from "../../utils/styles";

interface PlayerProgressProps {
  currentTime: number;
  duration: number;
  dragTime: number | null;
  isDragging: boolean;
  barRef: React.RefObject<HTMLDivElement | null>;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
}

const PlayerProgressComponent: FC<PlayerProgressProps> = ({
  currentTime,
  duration,
  dragTime,
  isDragging,
  barRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}) => {
  const displayTime = dragTime ?? currentTime;
  const progress = duration > 0 ? Math.min(100, Math.max(0, (displayTime / duration) * 100)) : 0;

  return (
    <PanelSectionRow>
      <div style={{ padding: "10px 0" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "12px",
            color: COLORS.textSecondary,
            marginBottom: "8px",
          }}
        >
          <span>{formatDuration(Math.floor(displayTime))}</span>
          <span>{formatDuration(duration)}</span>
        </div>
        <div
          ref={barRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            height: "12px",
            background: COLORS.backgroundDarker,
            borderRadius: "6px",
            overflow: "hidden",
            position: "relative",
            cursor: duration ? "pointer" : "default",
            touchAction: "none",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progress}%`,
              background: `linear-gradient(90deg, ${COLORS.primary}, ${COLORS.primaryLight})`,
              borderRadius: "4px",
              transition: isDragging ? "none" : "width 0.1s linear",
            }}
          />
        </div>
      </div>
    </PanelSectionRow>
  );
};

export const PlayerProgress = memo(PlayerProgressComponent);

import { FC, memo } from "react";
import type { PointerEvent } from "react";
import { PanelSectionRow } from "@decky/ui";
import { COLORS } from "../../utils/styles";

interface PlayerVolumeProps {
  volume: number;
  volumeDraft: number | null;
  isDragging: boolean;
  barRef: React.RefObject<HTMLDivElement | null>;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
}

const PlayerVolumeComponent: FC<PlayerVolumeProps> = ({
  volume,
  volumeDraft,
  isDragging,
  barRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}) => {
  const displayVolume = volumeDraft ?? volume;
  const volumePercent = Math.round(displayVolume * 100);
  const isLowVolume = displayVolume < 0.1;

  return (
    <PanelSectionRow>
      <div style={{ padding: "4px 0" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "12px",
            color: COLORS.textSecondary,
            marginBottom: "6px",
          }}
        >
          <span>音量</span>
          <span style={{ color: isLowVolume ? "#f59e0b" : COLORS.textSecondary }}>
            {volumePercent}%
            {isLowVolume && " ⚠"}
          </span>
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
            cursor: "pointer",
            touchAction: "none",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${volumePercent}%`,
              background: `linear-gradient(90deg, ${COLORS.primary}, ${COLORS.primaryLight})`,
              borderRadius: "6px",
              transition: isDragging ? "none" : "width 0.1s linear",
            }}
          />
        </div>
      </div>
    </PanelSectionRow>
  );
};

export const PlayerVolume = memo(PlayerVolumeComponent);

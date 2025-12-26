import { FC, memo } from "react";
import type { CSSProperties } from "react";

import { formatDuration } from "../../utils/format";

interface PlayerProgressProps {
  hasSong: boolean;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
}

const progressContainerStyle: CSSProperties = {
  width: "100%",
  maxWidth: "240px",
  marginBottom: "12px",
};
const progressBarOuterStyle: CSSProperties = {
  width: "100%",
  height: "3px",
  background: "rgba(255,255,255,0.1)",
  borderRadius: "2px",
  overflow: "hidden",
  cursor: "pointer",
};
const progressTimeStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: "10px",
  color: "#666",
  marginTop: "4px",
};

export const PlayerProgress: FC<PlayerProgressProps> = memo(
  ({ hasSong, currentTime, duration, onSeek }) => {
    if (!hasSong) return null;
    const percent = duration ? (currentTime / duration) * 100 : 0;
    return (
      <div style={progressContainerStyle}>
        <div
          style={progressBarOuterStyle}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const percentClick = (e.clientX - rect.left) / rect.width;
            const newTime = percentClick * (duration || 0);
            onSeek(newTime);
          }}
        >
          <div
            style={{
              width: `${percent}%`,
              height: "100%",
              background: "#1db954",
              borderRadius: "2px",
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

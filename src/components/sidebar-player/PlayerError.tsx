import { FC, memo } from "react";
import { PanelSectionRow, Focusable } from "@decky/ui";
import { COLORS } from "../../utils/styles";

interface PlayerErrorProps {
  error: string;
  hasPlaylist: boolean;
  onSkip?: () => void;
}

const PlayerErrorComponent: FC<PlayerErrorProps> = ({ error, hasPlaylist, onSkip }) => (
  <PanelSectionRow>
    <Focusable
      noFocusRing={!hasPlaylist}
      onActivate={hasPlaylist && onSkip ? onSkip : undefined}
      onClick={hasPlaylist && onSkip ? onSkip : undefined}
      style={{
        textAlign: "center",
        color: COLORS.error,
        fontSize: "13px",
        padding: "12px",
        background: COLORS.errorBg,
        borderRadius: "8px",
        cursor: hasPlaylist ? "pointer" : "default",
      }}
    >
      <div style={{ marginBottom: "6px" }}>⚠️ {error}</div>
      {hasPlaylist && (
        <div style={{ fontSize: "12px", color: COLORS.textSecondary }}>
          点击跳过或等待自动播放下一首
        </div>
      )}
    </Focusable>
  </PanelSectionRow>
);

export const PlayerError = memo(PlayerErrorComponent);

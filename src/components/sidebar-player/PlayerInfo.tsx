import { FC, memo } from "react";
import { PanelSectionRow } from "@decky/ui";
import { COLORS } from "../../utils/styles";

interface PlayerInfoProps {
  name: string;
  singer: string;
  album?: string;
}

const PlayerInfoComponent: FC<PlayerInfoProps> = ({ name, singer, album }) => (
  <PanelSectionRow>
    <div style={{ textAlign: "center", padding: "5px 0" }}>
      <div
        style={{
          fontSize: "18px",
          fontWeight: 600,
          color: COLORS.textPrimary,
          marginBottom: "6px",
        }}
      >
        {name}
      </div>
      <div style={{ fontSize: "14px", color: COLORS.textSecondary }}>
        {singer}
        {album ? ` · ${album}` : ""}
      </div>
    </div>
  </PanelSectionRow>
);

export const PlayerInfo = memo(PlayerInfoComponent);

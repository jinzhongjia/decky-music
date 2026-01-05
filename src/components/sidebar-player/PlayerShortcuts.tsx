import { FC, memo } from "react";
import { PanelSectionRow } from "@decky/ui";
import { COLORS } from "../../utils/styles";

const PlayerShortcutsComponent: FC = () => (
  <PanelSectionRow>
    <div
      style={{
        textAlign: "center",
        fontSize: "12px",
        color: COLORS.textSecondary,
        padding: "8px 0",
      }}
    >
      <span style={{ marginRight: "16px" }}>L1 上一首</span>
      <span style={{ marginRight: "16px" }}>X 暂停/继续</span>
      <span>R1 下一首</span>
    </div>
  </PanelSectionRow>
);

export const PlayerShortcuts = memo(PlayerShortcutsComponent);

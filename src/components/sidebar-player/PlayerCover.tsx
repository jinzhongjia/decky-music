import { FC, memo } from "react";
import { PanelSectionRow } from "@decky/ui";
import { SafeImage } from "../common";

interface PlayerCoverProps {
  cover: string;
  name: string;
  isPlaying: boolean;
}

const PlayerCoverComponent: FC<PlayerCoverProps> = ({ cover, name, isPlaying }) => (
  <PanelSectionRow>
    <div style={{ textAlign: "center", padding: "15px" }}>
      <SafeImage
        src={cover}
        alt={name}
        size={180}
        style={{
          width: "180px",
          height: "180px",
          borderRadius: "12px",
          objectFit: "cover",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          animation: isPlaying ? "spin 12s linear infinite" : "none",
        }}
      />
    </div>
  </PanelSectionRow>
);

export const PlayerCover = memo(PlayerCoverComponent);

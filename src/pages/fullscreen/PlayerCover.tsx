import React, { FC, memo } from "react";
import { FaMusic } from "react-icons/fa";

import { SafeImage } from "../../components/SafeImage";
import type { SongInfo } from "../../types";

interface PlayerCoverProps {
  song: SongInfo | null;
}

const COVER_WRAPPER_STYLE: React.CSSProperties = {
  width: "180px",
  height: "180px",
  borderRadius: "8px",
  overflow: "hidden",
  boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
  marginBottom: "16px",
  flexShrink: 0,
};

const EMPTY_COVER_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  background: "linear-gradient(135deg, #1db954 0%, #191414 100%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export const PlayerCover: FC<PlayerCoverProps> = memo(({ song }) => (
  <div style={COVER_WRAPPER_STYLE}>
    {song?.cover ? (
      <SafeImage
        src={song.cover}
        alt="封面"
        size={180}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    ) : (
      <div style={EMPTY_COVER_STYLE}>
        <FaMusic size={50} color="rgba(255,255,255,0.3)" />
      </div>
    )}
  </div>
));

PlayerCover.displayName = "PlayerCover";

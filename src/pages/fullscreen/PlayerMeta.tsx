import { FC, memo } from "react";
import type { CSSProperties } from "react";

import type { SongInfo } from "../../types";

interface PlayerMetaProps {
  song: SongInfo | null;
}

const PLAYER_TITLE_STYLE: CSSProperties = {
  fontSize: "16px",
  fontWeight: "bold",
  marginBottom: "4px",
  color: "#fff",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const PLAYER_SUBTITLE_STYLE: CSSProperties = {
  fontSize: "13px",
  color: "#8b929a",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export const PlayerMeta: FC<PlayerMetaProps> = memo(({ song }) => (
  <div style={{ textAlign: "center", marginBottom: "12px", width: "100%" }}>
    <div style={PLAYER_TITLE_STYLE}>{song?.name || "未播放"}</div>
    <div style={PLAYER_SUBTITLE_STYLE}>{song?.singer || "选择一首歌曲"}</div>
  </div>
));

PlayerMeta.displayName = "PlayerMeta";

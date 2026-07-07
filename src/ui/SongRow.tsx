// 歌曲行(共享原语):封面 + 歌名 + VIP 徽标 + 歌手·专辑 + 时长。Focusable(手柄 A 触发)。
// 搜索结果 / 歌单 / 队列面板等列表复用。对齐 docs/ui-design 效果图的富行,而非纯文字胶囊。

import { Focusable } from "@decky/ui";

import { Song } from "../api";
import { fmtTime, theme } from "./theme";

export function SongRow({ song, onClick }: { song: Song; onClick: () => void }) {
  return (
    <Focusable
      onActivate={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.5rem 0.75rem",
        borderRadius: theme.radius,
      }}
    >
      {song.cover ? (
        <img
          src={song.cover}
          style={{
            width: 48,
            height: 48,
            borderRadius: theme.radius,
            objectFit: "cover",
            flexShrink: 0,
          }}
          alt=""
        />
      ) : (
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: theme.radius,
            background: "#333",
            flexShrink: 0,
          }}
        />
      )}
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          <span style={{ color: theme.text, overflow: "hidden", textOverflow: "ellipsis" }}>
            {song.name}
          </span>
          {song.vip && (
            <span
              style={{
                flexShrink: 0,
                fontSize: "0.65em",
                lineHeight: 1,
                padding: "0.15em 0.35em",
                borderRadius: 3,
                color: "#2ecc71",
                border: "1px solid #2ecc71",
              }}
            >
              VIP
            </span>
          )}
        </div>
        <div
          style={{
            color: theme.textDim,
            fontSize: "0.8em",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {song.singer}
          {song.album ? ` · ${song.album}` : ""}
        </div>
      </div>
      <div style={{ color: theme.textDim, fontSize: "0.85em", flexShrink: 0 }}>
        {fmtTime(song.duration)}
      </div>
    </Focusable>
  );
}

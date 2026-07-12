// 内容页共享原语(P5a 起):Section 小节 / HeroCard 大入口卡 / PlaylistCard 歌单卡 / SongCell 歌曲格。
// 视觉遵循 specs/steam-deck-ui-rules.md:封面即卡片(小圆角)、细白描边焦点、品牌色只做点缀。
// 网格容器统一 MAINTAIN_X(上下移动不错列)。

import { Focusable, NavEntryPositionPreferences } from "@decky/ui";
import { ReactNode } from "react";

import { Album, Artist, Playlist, Song } from "../api";
import { fmtCount } from "../i18n";
import { theme } from "./theme";

// 小节:小字灰标题 + 内容
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div style={{ color: theme.textDim, fontSize: "0.8em", fontWeight: 600 }}>{title}</div>
      {children}
    </div>
  );
}

// 网格容器:MAINTAIN_X。cols = 固定列数(配合取数条数凑整行,避免残行)
export function Grid({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <Focusable
      navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap: "0.75rem",
      }}
    >
      {children}
    </Focusable>
  );
}

// 大入口卡(智能电台/每日推荐):渐变底 + 标题/副题 + 右侧大图标
export function HeroCard({
  title,
  subtitle,
  icon,
  accent,
  onActivate,
  disabled,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  accent: string;
  onActivate?: () => void;
  disabled?: boolean;
}) {
  return (
    <Focusable
      onActivate={disabled ? undefined : onActivate}
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "1rem 1.25rem",
        borderRadius: theme.radius,
        background: `linear-gradient(135deg, ${accent}26, ${accent}0d)`,
        border: `1px solid ${accent}40`,
        opacity: disabled ? 0.45 : 1,
        minHeight: 72,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ color: theme.text, fontWeight: 700, fontSize: "1.1em" }}>{title}</div>
        <div style={{ color: theme.textDim, fontSize: "0.8em", marginTop: "0.2rem" }}>
          {subtitle}
        </div>
      </div>
      <div style={{ color: accent, fontSize: "1.8em", flexShrink: 0, marginLeft: "1rem" }}>
        {icon}
      </div>
    </Focusable>
  );
}

// 歌单卡:方形封面 + 播放量角标 + 名称(两行截断)
export function PlaylistCard({ pl, onActivate }: { pl: Playlist; onActivate: () => void }) {
  return (
    <Focusable onActivate={onActivate} style={{ borderRadius: theme.radius }}>
      <div style={{ position: "relative" }}>
        <img
          src={pl.cover || undefined}
          style={{
            width: "100%",
            aspectRatio: "1",
            objectFit: "cover",
            borderRadius: theme.radius,
            background: "#333",
            display: "block",
          }}
          alt=""
        />
        {pl.play_count > 0 && (
          <span
            style={{
              position: "absolute",
              top: 4,
              left: 4,
              padding: "0.1em 0.45em",
              borderRadius: 3,
              background: "rgba(0,0,0,0.6)",
              color: theme.text,
              fontSize: "0.7em",
            }}
          >
            ▶ {fmtCount(pl.play_count)}
          </span>
        )}
      </div>
      <div
        style={{
          color: theme.text,
          fontSize: "0.82em",
          marginTop: "0.35rem",
          lineHeight: 1.3,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {pl.name}
      </div>
    </Focusable>
  );
}

// 歌曲格(新歌网格):左封面 + 右歌名/歌手
export function SongCell({ song, onActivate }: { song: Song; onActivate: () => void }) {
  return (
    <Focusable
      onActivate={onActivate}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.6rem",
        padding: "0.35rem",
        borderRadius: theme.radius,
      }}
    >
      <img
        src={song.cover || undefined}
        style={{
          width: 56,
          height: 56,
          borderRadius: theme.radius,
          objectFit: "cover",
          background: "#333",
          flexShrink: 0,
        }}
        alt=""
      />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: theme.text,
            fontSize: "0.9em",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {song.name}
        </div>
        <div
          style={{
            color: theme.textDim,
            fontSize: "0.78em",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {song.singer}
        </div>
      </div>
    </Focusable>
  );
}

// 专辑卡(搜索专辑分类):方形封面 + 专辑名 + 歌手副题
export function AlbumCard({ album, onActivate }: { album: Album; onActivate: () => void }) {
  return (
    <Focusable onActivate={onActivate} style={{ borderRadius: theme.radius }}>
      <img
        src={album.cover || undefined}
        style={{
          width: "100%",
          aspectRatio: "1",
          objectFit: "cover",
          borderRadius: theme.radius,
          background: "#333",
          display: "block",
        }}
        alt=""
      />
      <div
        style={{
          color: theme.text,
          fontSize: "0.82em",
          marginTop: "0.35rem",
          lineHeight: 1.3,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {album.name}
      </div>
      <div
        style={{
          color: theme.textDim,
          fontSize: "0.72em",
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
        }}
      >
        {album.artist}
      </div>
    </Focusable>
  );
}

// 歌手卡(搜索歌手分类):圆头像 + 居中名字
export function ArtistCard({ artist, onActivate }: { artist: Artist; onActivate: () => void }) {
  return (
    <Focusable
      onActivate={onActivate}
      style={{ borderRadius: theme.radius, textAlign: "center", padding: "0.25rem" }}
    >
      <img
        src={artist.avatar || undefined}
        style={{
          width: "100%",
          aspectRatio: "1",
          objectFit: "cover",
          borderRadius: "50%",
          background: "#333",
          display: "block",
        }}
        alt=""
      />
      <div
        style={{
          color: theme.text,
          fontSize: "0.82em",
          marginTop: "0.35rem",
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
        }}
      >
        {artist.name}
      </div>
    </Focusable>
  );
}

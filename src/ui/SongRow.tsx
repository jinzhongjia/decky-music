// 歌曲行(共享原语):封面 + 歌名 + VIP 徽标 + 歌手·专辑 + 时长。Focusable(手柄 A 触发)。
// 搜索结果 / 歌单等列表复用。onMenu:X 键上下文菜单(P4,入队操作),图例随焦点同步。

import { Focusable } from "@decky/ui";

import { Song } from "../api";
import { t } from "../i18n";
import { playQueue } from "../player/usePlayer";
import { openSongMenu } from "./songMenu";
import { fmtTime, theme } from "./theme";

// 歌曲列表容器样式:纵向滚动、行间距一致(资产/搜索列表与详情页共用)
export const songListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.4rem",
  flexGrow: 1,
  minHeight: 0,
  overflowY: "auto",
};

/** 一列歌曲行:A = 以整列建队并定位该曲(QUEUE-BEHAVIOR §2),X = 入队菜单。
 *  空/加载态由调用方渲染 —— 列表页居中、详情页贴顶,排版不同不强行统一。 */
export function SongRows({
  songs,
  queue = songs,
  startIndex = 0,
}: {
  songs: Song[];
  queue?: Song[];
  startIndex?: number;
}) {
  return (
    <>
      {songs.map((s, i) => (
        <SongRow
          key={`${s.mid}-${startIndex + i}`}
          song={s}
          onClick={() => playQueue(queue, startIndex + i)}
          onMenu={() => openSongMenu(s)}
        />
      ))}
    </>
  );
}

export function SongRow({
  song,
  onClick,
  onMenu,
}: {
  song: Song;
  onClick: () => void;
  onMenu?: () => void;
}) {
  return (
    <Focusable
      onActivate={onClick}
      onSecondaryButton={onMenu}
      onSecondaryActionDescription={onMenu ? t("moreActions") : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.5rem 0.75rem",
        borderRadius: theme.radius,
      }}
    >
      <img
        src={song.cover || undefined}
        loading="lazy"
        decoding="async"
        style={{
          width: 48,
          height: 48,
          borderRadius: theme.radius,
          objectFit: "cover",
          background: "#333",
          flexShrink: 0,
        }}
        alt=""
      />
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

// 歌单/专辑/歌手详情共骨:独立路由全屏框架(与 Page 同规格安全边距)+
// 封面头(标题/副题/播放全部)+ SongRow 全宽列表。B = Steam 原生路由返回。
// A 单曲 = 以整列建队定位该曲(QUEUE-BEHAVIOR §2);X = 入队菜单。

import { DialogButton, Focusable } from "@decky/ui";

import { Song } from "../api";
import { t } from "../i18n";
import { playQueue } from "../player/usePlayer";
import { usePlaybackShortcuts } from "../ui/AppShell";
import { SongRow } from "../ui/SongRow";
import { openSongMenu } from "../ui/songMenu";
import { theme } from "../ui/theme";
import { nearBottom } from "../ui/useAsync";

export function CollectionPage({
  cover,
  roundCover = false,
  title,
  subtitle,
  songs,
  empty = false,
  loadMore,
}: {
  cover: string;
  roundCover?: boolean; // 歌手页头像用圆形
  title: string;
  subtitle: string;
  songs: Song[] | null; // null = 加载中
  empty?: boolean; // 无选中项(未经入口直进路由)
  loadMore?: () => void; // 分页取数(歌单详情);滚近列表底部触发
}) {
  const shortcuts = usePlaybackShortcuts();
  const coverStyle = {
    width: 96,
    height: 96,
    borderRadius: roundCover ? "50%" : theme.radius,
    flexShrink: 0,
  } as const;

  return (
    <Focusable
      {...shortcuts}
      style={{
        height: "100%",
        boxSizing: "border-box",
        padding: "48px 2rem 44px",
        background: theme.bg,
        color: theme.text,
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        overflow: "hidden",
      }}
    >
      {empty ? (
        <div style={{ margin: "auto", color: theme.textDim }}>{t("noResults")}</div>
      ) : (
        <>
          {/* 封面头 */}
          <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexShrink: 0 }}>
            <img
              src={cover || undefined}
              style={{ ...coverStyle, objectFit: "cover", background: "#333" }}
              alt=""
            />
            <div style={{ minWidth: 0, flexGrow: 1 }}>
              <div style={{ color: theme.text, fontWeight: 700, fontSize: "1.15em" }}>{title}</div>
              <div style={{ color: theme.textDim, fontSize: "0.85em", marginTop: "0.25rem" }}>
                {subtitle}
              </div>
            </div>
            <DialogButton
              // 进入详情页立即取焦(Valve nav 原生 prop,decky 类型未声明,经 spread 透传)
              {...({ autoFocus: true } as object)}
              disabled={!songs?.length}
              onClick={() => songs?.length && playQueue(songs, 0)}
              style={{ minWidth: 0, width: "auto", padding: "0.5em 1.5em", flexShrink: 0 }}
            >
              {t("playAll")}
            </DialogButton>
          </div>

          {/* 曲目列表 */}
          <Focusable
            onScroll={loadMore ? (e) => nearBottom(e) && loadMore() : undefined}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.4rem",
              flexGrow: 1,
              minHeight: 0,
              overflowY: "auto",
            }}
          >
            {songs === null ? (
              <div style={{ color: theme.textDim }}>{t("loading")}</div>
            ) : songs.length === 0 ? (
              <div style={{ color: theme.textDim }}>{t("noResults")}</div>
            ) : (
              songs.map((s, i) => (
                <SongRow
                  key={`${s.mid}-${i}`}
                  song={s}
                  onClick={() => playQueue(songs, i)}
                  onMenu={() => openSongMenu(s)}
                />
              ))
            )}
          </Focusable>
        </>
      )}
    </Focusable>
  );
}

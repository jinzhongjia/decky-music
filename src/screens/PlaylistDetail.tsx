// 歌单详情(独立路由页,P5c):封面头(名/曲数/播放量 + 播放全部)+ SongRow 全宽列表。
// A 单曲 = 以整单建队定位该曲(QUEUE-BEHAVIOR §2 上下文替换);X = 入队菜单。
// 导航用真路由:openPlaylistDetail() 设选中歌单 + Navigate;B = Steam 原生路由返回
// (页内子视图的 onCancelButton 拦不住系统返回,已废弃该方案)。

import { Focusable, Navigation } from "@decky/ui";
import { DialogButton } from "@decky/ui";

import { Playlist, Song, api } from "../api";
import { reportError } from "../errors";
import { fmtCount, t } from "../i18n";
import { playQueue } from "../player/usePlayer";
import { usePlaybackShortcuts } from "../ui/AppShell";
import { SongRow } from "../ui/SongRow";
import { openSongMenu } from "../ui/songMenu";
import { theme } from "../ui/theme";
import { useAsync } from "../ui/useAsync";

export const DETAIL_ROUTE = "/music-playlist";

// 选中歌单经模块级变量传递(路由无参;Navigate 前设置,页面挂载时读取)
let currentPl: Playlist | null = null;

export function openPlaylistDetail(pl: Playlist) {
  currentPl = pl;
  Navigation.Navigate(DETAIL_ROUTE);
}

export function PlaylistDetailPage() {
  const pl = currentPl;
  const shortcuts = usePlaybackShortcuts();
  const songs = useAsync<Song[] | null>(
    () =>
      pl
        ? api
            .getPlaylistSongs(pl.id)
            .then((r) => (r.ok ? (r.songs ?? []) : []))
            .catch((e) => {
              reportError(e instanceof Error ? e.message : String(e));
              return [];
            })
        : Promise.resolve(null),
    [pl?.id]
  );

  return (
    // 独立路由页:自带全屏框架(与 Page 同规格的安全边距)
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
      {!pl ? (
        <div style={{ margin: "auto", color: theme.textDim }}>{t("noResults")}</div>
      ) : (
        <>
          {/* 封面头 */}
          <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexShrink: 0 }}>
            {pl.cover ? (
              <img
                src={pl.cover}
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: theme.radius,
                  objectFit: "cover",
                  flexShrink: 0,
                }}
                alt=""
              />
            ) : (
              <div
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: theme.radius,
                  background: "#333",
                  flexShrink: 0,
                }}
              />
            )}
            <div style={{ minWidth: 0, flexGrow: 1 }}>
              <div style={{ color: theme.text, fontWeight: 700, fontSize: "1.15em" }}>
                {pl.name}
              </div>
              <div style={{ color: theme.textDim, fontSize: "0.85em", marginTop: "0.25rem" }}>
                {pl.count > 0 && `${pl.count} ${t("songsUnit")}`}
                {pl.play_count > 0 && ` · ▶ ${fmtCount(pl.play_count)}`}
              </div>
            </div>
            <DialogButton
              disabled={!songs?.length}
              onClick={() => songs?.length && playQueue(songs, 0)}
              style={{ minWidth: 0, width: "auto", padding: "0.5em 1.5em", flexShrink: 0 }}
            >
              {t("playAll")}
            </DialogButton>
          </div>

          {/* 曲目列表 */}
          <Focusable
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

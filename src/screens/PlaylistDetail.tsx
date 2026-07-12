// 歌单详情(独立路由页,P5c):共骨 CollectionPage,曲目经 getPlaylistSongs 拉取。
// 导航用真路由:openPlaylistDetail() 设选中歌单 + Navigate;B = Steam 原生路由返回
// (页内子视图的 onCancelButton 拦不住系统返回,已废弃该方案)。

import { Navigation } from "@decky/ui";

import { Playlist, Song, api } from "../api";
import { reportError } from "../errors";
import { fmtCount, t } from "../i18n";
import { useAsync } from "../ui/useAsync";
import { CollectionPage } from "./CollectionPage";

export const DETAIL_ROUTE = "/music-playlist";

// 选中歌单经模块级变量传递(路由无参;Navigate 前设置,页面挂载时读取)
let currentPl: Playlist | null = null;

export function openPlaylistDetail(pl: Playlist) {
  currentPl = pl;
  Navigation.Navigate(DETAIL_ROUTE);
}

export function PlaylistDetailPage() {
  const pl = currentPl;
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

  const subtitle = pl
    ? [
        pl.count > 0 && `${pl.count} ${t("songsUnit")}`,
        pl.play_count > 0 && `▶ ${fmtCount(pl.play_count)}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  return (
    <CollectionPage
      empty={!pl}
      cover={pl?.cover ?? ""}
      title={pl?.name ?? ""}
      subtitle={subtitle}
      songs={songs}
    />
  );
}

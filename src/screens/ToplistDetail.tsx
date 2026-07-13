// 榜单详情(独立路由页,P6):共骨 CollectionPage + 分页(QQ num/page / NCM 歌单同源)。
// 入口:推荐/发现页榜单区块。导航范式同歌单详情(模块级变量 + 真路由)。

import { Navigation } from "@decky/ui";

import { Playlist, api, errorText } from "../api";
import { reportError } from "../errors";
import { fmtCount, t } from "../i18n";
import { usePaged } from "../ui/useAsync";
import { CollectionPage } from "./CollectionPage";

export const TOPLIST_ROUTE = "/music-toplist";

let currentTop: Playlist | null = null;

export function openToplistDetail(top: Playlist) {
  currentTop = top;
  Navigation.Navigate(TOPLIST_ROUTE);
}

export function ToplistDetailPage() {
  const top = currentTop;
  const { items: songs, loadMore } = usePaged(
    (offset) =>
      top
        ? api
            .getToplistSongs(top.id, offset)
            .then((r) => {
              if (!r.ok) reportError(errorText(r.error || "provider_error"));
              return r.songs ?? [];
            })
            .catch(() => [])
        : Promise.resolve([]),
    (s) => s.mid
  );

  const subtitle = top
    ? [
        top.count > 0 && `${top.count} ${t("songsUnit")}`,
        top.play_count > 0 && `▶ ${fmtCount(top.play_count)}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  return (
    <CollectionPage
      empty={!top}
      cover={top?.cover ?? ""}
      title={top?.name ?? ""}
      subtitle={subtitle}
      songs={songs}
      loadMore={loadMore}
    />
  );
}

// 分页详情页工厂(歌单/榜单同构:Playlist 形状 + 曲目分页 + CollectionPage 共骨)。
// 导航范式:模块级变量传选中项 + 真路由,B = Steam 原生返回。

import { Navigation } from "@decky/ui";

import { Playlist, SearchResult } from "../api";
import { fmtCount, t } from "../i18n";
import { unwrapList, usePaged } from "../ui/useAsync";
import { CollectionPage } from "./CollectionPage";

export function makePagedDetail(
  route: string,
  fetchSongs: (id: string, offset: number) => Promise<SearchResult>
) {
  let current: Playlist | null = null;

  const open = (item: Playlist) => {
    current = item;
    Navigation.Navigate(route);
  };

  function Page() {
    const item = current;
    const { items: songs, loadMore } = usePaged(
      (offset) =>
        item ? unwrapList(fetchSongs(item.id, offset), (r) => r.songs) : Promise.resolve([]),
      (s) => s.mid
    );

    const subtitle = item
      ? [
          item.count > 0 && `${item.count} ${t("songsUnit")}`,
          item.play_count > 0 && `▶ ${fmtCount(item.play_count)}`,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
    return (
      <CollectionPage
        empty={!item}
        cover={item?.cover ?? ""}
        title={item?.name ?? ""}
        subtitle={subtitle}
        songs={songs}
        loadMore={loadMore}
      />
    );
  }

  return { open, Page };
}

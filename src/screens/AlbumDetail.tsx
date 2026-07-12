// 专辑详情(独立路由页,P6):封面 + 曲目(provider {album, songs})。
// 入口:搜索专辑分类卡片。导航范式同歌单详情(模块级变量 + 真路由)。

import { Navigation } from "@decky/ui";

import { Album, api, errorText } from "../api";
import { reportError } from "../errors";
import { t } from "../i18n";
import { useAsync } from "../ui/useAsync";
import { CollectionPage } from "./CollectionPage";

export const ALBUM_ROUTE = "/music-album";

let currentAlbum: Album | null = null;

export function openAlbumDetail(a: Album) {
  currentAlbum = a;
  Navigation.Navigate(ALBUM_ROUTE);
}

export function AlbumDetailPage() {
  const album = currentAlbum;
  const songs = useAsync(
    () =>
      album
        ? api
            .getAlbumDetail(album.id)
            .then((r) => {
              if (!r.ok) reportError(errorText(r.error || "provider_error"));
              return r.songs ?? [];
            })
            .catch(() => [])
        : Promise.resolve(null),
    [album?.id]
  );

  const subtitle = album
    ? [album.artist, album.count > 0 && `${album.count} ${t("songsUnit")}`]
        .filter(Boolean)
        .join(" · ")
    : "";
  return (
    <CollectionPage
      empty={!album}
      cover={album?.cover ?? ""}
      title={album?.name ?? ""}
      subtitle={subtitle}
      songs={songs}
    />
  );
}

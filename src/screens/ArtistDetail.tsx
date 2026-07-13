// 歌手详情(独立路由页,P6):圆头像 + 热门歌曲(provider {artist, songs})。
// 入口:搜索歌手分类卡片。导航范式同歌单详情(模块级变量 + 真路由)。

import { Navigation } from "@decky/ui";

import { Artist, api } from "../api";
import { t } from "../i18n";
import { unwrapList, useAsync } from "../ui/useAsync";
import { CollectionPage } from "./CollectionPage";

export const ARTIST_ROUTE = "/music-artist";

let currentArtist: Artist | null = null;

export function openArtistDetail(a: Artist) {
  currentArtist = a;
  Navigation.Navigate(ARTIST_ROUTE);
}

export function ArtistDetailPage() {
  const artist = currentArtist;
  const songs = useAsync(
    () =>
      artist ? unwrapList(api.getArtistDetail(artist.id), (r) => r.songs) : Promise.resolve(null),
    [artist?.id]
  );

  return (
    <CollectionPage
      empty={!artist}
      cover={artist?.avatar ?? ""}
      roundCover
      title={artist?.name ?? ""}
      subtitle={t("hotSongs")}
      songs={songs}
    />
  );
}

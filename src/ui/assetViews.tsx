// 资产/搜索列表视图(共享):歌曲列表(高密度 SongRow)/ 歌单/专辑/歌手网格。
// fetch(offset) 由调用方注入;usePaged 追加分页,滚近容器底部自动拉下一页。

import { ReactNode } from "react";

import { AlbumsResult, ArtistsResult, PlaylistsResult, SearchResult } from "../api";
import { t } from "../i18n";
import { openAlbumDetail } from "../screens/AlbumDetail";
import { openArtistDetail } from "../screens/ArtistDetail";
import { openPlaylistDetail } from "../screens/PlaylistDetail";
import { SongRows, songListStyle } from "./SongRow";
import { openPlaylistMenu } from "./playlistMenu";
import { AlbumCard, ArtistCard, PlaylistCard } from "./cards";
import { theme } from "./theme";
import { unwrapList, usePaged } from "./useAsync";
import { WindowedGrid, WindowedList } from "./Windowed";

export function SongListView({ fetch }: { fetch: (offset: number) => Promise<SearchResult> }) {
  const { items: songs, loadMore } = usePaged(
    (offset) => unwrapList(fetch(offset), (r) => r.songs),
    (s) => s.mid
  );

  if (songs === null) {
    return <div style={{ margin: "auto", color: theme.textDim }}>{t("loading")}</div>;
  }
  if (songs.length === 0) {
    return <div style={{ margin: "auto", color: theme.textDim }}>{t("noResults")}</div>;
  }
  return (
    <WindowedList
      items={songs}
      itemHeight={72}
      onNearBottom={loadMore}
      renderItem={(song, index) => <SongRows songs={[song]} queue={songs} startIndex={index} />}
      style={songListStyle}
    />
  );
}

// 泛型卡片网格(歌单/专辑/歌手三套视图的共骨):分页 + 到底翻页 + 空/加载态
function GridView<T extends { id: string }>({
  fetch,
  labelHeight,
  renderCard,
}: {
  fetch: (offset: number) => Promise<T[]>;
  labelHeight: number;
  renderCard: (item: T, i: number) => ReactNode;
}) {
  const { items, loadMore } = usePaged(fetch, (x) => x.id);

  if (items === null) {
    return <div style={{ margin: "auto", color: theme.textDim }}>{t("loading")}</div>;
  }
  if (items.length === 0) {
    return <div style={{ margin: "auto", color: theme.textDim }}>{t("noResults")}</div>;
  }
  return (
    <WindowedGrid
      items={items}
      cols={6}
      labelHeight={labelHeight}
      onNearBottom={loadMore}
      renderItem={renderCard}
      style={{ flexGrow: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}
    />
  );
}

export function PlaylistGridView({
  fetch,
  favoritable = false, // 搜索结果=别人的歌单,可收藏;自建/已收藏的不给这个动作
}: {
  fetch: (offset: number) => Promise<PlaylistsResult>;
  favoritable?: boolean;
}) {
  return (
    <GridView
      fetch={(offset) => unwrapList(fetch(offset), (r) => r.playlists)}
      labelHeight={56}
      renderCard={(pl, i) => (
        <PlaylistCard
          key={`${pl.id}-${i}`}
          pl={pl}
          onActivate={() => openPlaylistDetail(pl)}
          onMenu={favoritable ? () => openPlaylistMenu(pl) : undefined}
        />
      )}
    />
  );
}

export function AlbumGridView({ fetch }: { fetch: (offset: number) => Promise<AlbumsResult> }) {
  return (
    <GridView
      fetch={(offset) => unwrapList(fetch(offset), (r) => r.albums)}
      labelHeight={72}
      renderCard={(a, i) => (
        <AlbumCard key={`${a.id}-${i}`} album={a} onActivate={() => openAlbumDetail(a)} />
      )}
    />
  );
}

export function ArtistGridView({ fetch }: { fetch: (offset: number) => Promise<ArtistsResult> }) {
  return (
    <GridView
      fetch={(offset) => unwrapList(fetch(offset), (r) => r.artists)}
      labelHeight={36}
      renderCard={(a, i) => (
        <ArtistCard key={`${a.id}-${i}`} artist={a} onActivate={() => openArtistDetail(a)} />
      )}
    />
  );
}

// 资产/搜索列表视图(共享):歌曲列表(高密度 SongRow)/ 歌单/专辑/歌手网格。
// fetch(offset) 由调用方注入;usePaged 追加分页,滚近容器底部自动拉下一页。

import { Focusable } from "@decky/ui";
import { ReactNode } from "react";

import { AlbumsResult, ArtistsResult, PlaylistsResult, SearchResult } from "../api";
import { t } from "../i18n";
import { playQueue } from "../player/usePlayer";
import { openAlbumDetail } from "../screens/AlbumDetail";
import { openArtistDetail } from "../screens/ArtistDetail";
import { openPlaylistDetail } from "../screens/PlaylistDetail";
import { SongRow } from "./SongRow";
import { openSongMenu } from "./songMenu";
import { AlbumCard, ArtistCard, Grid, PlaylistCard } from "./cards";
import { theme } from "./theme";
import { nearBottom, unwrapList, usePaged } from "./useAsync";

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
    <Focusable
      onScroll={(e) => nearBottom(e) && loadMore()}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.4rem",
        flexGrow: 1,
        minHeight: 0,
        overflowY: "auto",
      }}
    >
      {songs.map((s, i) => (
        <SongRow
          key={`${s.mid}-${i}`}
          song={s}
          onClick={() => playQueue(songs, i)}
          onMenu={() => openSongMenu(s)}
        />
      ))}
    </Focusable>
  );
}

// 泛型卡片网格(歌单/专辑/歌手三套视图的共骨):分页 + 到底翻页 + 空/加载态
function GridView<T extends { id: string }>({
  fetch,
  renderCard,
}: {
  fetch: (offset: number) => Promise<T[]>;
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
    <div
      onScroll={(e) => nearBottom(e) && loadMore()}
      style={{ flexGrow: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}
    >
      <Grid cols={6}>{items.map(renderCard)}</Grid>
    </div>
  );
}

export function PlaylistGridView({
  fetch,
}: {
  fetch: (offset: number) => Promise<PlaylistsResult>;
}) {
  return (
    <GridView
      fetch={(offset) => unwrapList(fetch(offset), (r) => r.playlists)}
      renderCard={(pl, i) => (
        <PlaylistCard key={`${pl.id}-${i}`} pl={pl} onActivate={() => openPlaylistDetail(pl)} />
      )}
    />
  );
}

export function AlbumGridView({ fetch }: { fetch: (offset: number) => Promise<AlbumsResult> }) {
  return (
    <GridView
      fetch={(offset) => unwrapList(fetch(offset), (r) => r.albums)}
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
      renderCard={(a, i) => (
        <ArtistCard key={`${a.id}-${i}`} artist={a} onActivate={() => openArtistDetail(a)} />
      )}
    />
  );
}

// 资产/搜索列表视图(共享):歌曲列表(高密度 SongRow)/ 歌单网格(PlaylistCard)。
// fetch(offset) 由调用方注入;usePaged 追加分页,滚近容器底部自动拉下一页(P6)。

import { Focusable } from "@decky/ui";
import { UIEvent } from "react";

import { PlaylistsResult, SearchResult, errorText } from "../api";
import { reportError } from "../errors";
import { t } from "../i18n";
import { playQueue } from "../player/usePlayer";
import { openPlaylistDetail } from "../screens/PlaylistDetail";
import { SongRow } from "./SongRow";
import { openSongMenu } from "./songMenu";
import { Grid, PlaylistCard } from "./cards";
import { theme } from "./theme";
import { usePaged } from "./useAsync";

// 距底 300px 内触发下一页(焦点移动把行滚入视口时同样产生 scroll 事件,手柄可用)
const nearBottom = (e: UIEvent<HTMLDivElement>) => {
  const el = e.currentTarget;
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 300;
};

export function SongListView({ fetch }: { fetch: (offset: number) => Promise<SearchResult> }) {
  const { items: songs, loadMore } = usePaged(
    (offset) =>
      fetch(offset)
        .then((r) => {
          if (!r.ok) reportError(errorText(r.error || "provider_error"));
          return r.songs ?? [];
        })
        .catch(() => []),
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

export function PlaylistGridView({
  fetch,
}: {
  fetch: (offset: number) => Promise<PlaylistsResult>;
}) {
  const { items: playlists, loadMore } = usePaged(
    (offset) =>
      fetch(offset)
        .then((r) => {
          if (!r.ok) reportError(errorText(r.error || "provider_error"));
          return r.playlists ?? [];
        })
        .catch(() => []),
    (pl) => pl.id
  );

  if (playlists === null) {
    return <div style={{ margin: "auto", color: theme.textDim }}>{t("loading")}</div>;
  }
  if (playlists.length === 0) {
    return <div style={{ margin: "auto", color: theme.textDim }}>{t("noResults")}</div>;
  }
  return (
    <div
      onScroll={(e) => nearBottom(e) && loadMore()}
      style={{ flexGrow: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}
    >
      <Grid cols={6}>
        {playlists.map((pl, i) => (
          <PlaylistCard key={`${pl.id}-${i}`} pl={pl} onActivate={() => openPlaylistDetail(pl)} />
        ))}
      </Grid>
    </div>
  );
}

// 资产 Tab 内容视图(P5e 共享):歌曲列表(高密度 SongRow)/ 歌单网格(PlaylistCard)。
// fetch 由调用方注入(fav_songs / listen_rank / created_playlists / fav_playlists)。
// ponytail: 首页 50 条,翻页 P6。

import { Focusable } from "@decky/ui";
import { useEffect, useState } from "react";

import { Playlist, PlaylistsResult, SearchResult, Song, errorText } from "../api";
import { reportError } from "../errors";
import { t } from "../i18n";
import { playQueue } from "../player/usePlayer";
import { openPlaylistDetail } from "../screens/PlaylistDetail";
import { SongRow } from "./SongRow";
import { openSongMenu } from "./songMenu";
import { Grid, PlaylistCard } from "./cards";
import { theme } from "./theme";

export function SongListView({ fetch }: { fetch: () => Promise<SearchResult> }) {
  const [songs, setSongs] = useState<Song[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch()
      .then((r) => {
        if (!alive) return;
        if (!r.ok) reportError(errorText(r.error || "provider_error"));
        setSongs(r.songs ?? []);
      })
      .catch(() => alive && setSongs([]));
    return () => {
      alive = false;
    };
  }, []);

  if (songs === null) {
    return <div style={{ margin: "auto", color: theme.textDim }}>{t("loading")}</div>;
  }
  if (songs.length === 0) {
    return <div style={{ margin: "auto", color: theme.textDim }}>{t("noResults")}</div>;
  }
  return (
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

export function PlaylistGridView({ fetch }: { fetch: () => Promise<PlaylistsResult> }) {
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch()
      .then((r) => {
        if (!alive) return;
        if (!r.ok) reportError(errorText(r.error || "provider_error"));
        setPlaylists(r.playlists ?? []);
      })
      .catch(() => alive && setPlaylists([]));
    return () => {
      alive = false;
    };
  }, []);

  if (playlists === null) {
    return <div style={{ margin: "auto", color: theme.textDim }}>{t("loading")}</div>;
  }
  if (playlists.length === 0) {
    return <div style={{ margin: "auto", color: theme.textDim }}>{t("noResults")}</div>;
  }
  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
      <Grid cols={6}>
        {playlists.map((pl) => (
          <PlaylistCard key={pl.id} pl={pl} onActivate={() => openPlaylistDetail(pl)} />
        ))}
      </Grid>
    </div>
  );
}

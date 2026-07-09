// QQ 推荐页(P5a,效果图 qq-ui/01):智能电台大卡 ×2 + 推荐歌单网格 + 新歌首发网格。
// 电台卡 P5d(radio 队列模式)前置灰;歌单卡 A = 拉曲目整单入队开播。
// ponytail: 歌单详情页 P5c 再上,届时歌单卡 A 改进详情。

import { useEffect, useState } from "react";
import { FaHeartbeat, FaSatelliteDish } from "react-icons/fa";

import { Playlist, RecommendData, api } from "../../api";
import { guard, reportError } from "../../errors";
import { t } from "../../i18n";
import { playQueue } from "../../player/usePlayer";
import { Grid, HeroCard, PlaylistCard, Section, SongCell } from "../../ui/cards";
import { theme } from "../../ui/theme";

const QQ_GREEN = "#31c27c";

export function Recommend() {
  const [data, setData] = useState<RecommendData | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getRecommend()
      .then((d) => alive && setData(d))
      .catch((e) => {
        reportError(e instanceof Error ? e.message : String(e));
        if (alive) setData({ playlists: [], newsongs: [] });
      });
    return () => {
      alive = false;
    };
  }, []);

  // 歌单卡:拉曲目整单入队开播(P5c 详情页前的直接播放路径)
  const playPlaylist = (pl: Playlist) =>
    guard(async () => {
      const r = await api.getPlaylistSongs(pl.id);
      if (r.ok && r.songs?.length) playQueue(r.songs, 0);
      else reportError(t("noResults"));
    });

  if (!data) {
    return <div style={{ margin: "auto", color: theme.textDim }}>{t("loading")}</div>;
  }

  const empty = data.playlists.length === 0 && data.newsongs.length === 0;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1.25rem",
        flexGrow: 1,
        minWidth: 0,
        minHeight: 0,
        overflowY: "auto",
        paddingRight: "0.25rem",
      }}
    >
      <Section title={t("smartRadio")}>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          {/* P5d 前置灰:不建会失败的入口(specs);A 无动作 */}
          <HeroCard
            title={t("guessYouLike")}
            subtitle={`${t("guessDesc")} · ${t("comingSoon")}`}
            icon={<FaHeartbeat />}
            accent={QQ_GREEN}
            disabled
          />
          <HeroCard
            title={t("radarRec")}
            subtitle={`${t("radarDesc")} · ${t("comingSoon")}`}
            icon={<FaSatelliteDish />}
            accent={QQ_GREEN}
            disabled
          />
        </div>
      </Section>

      {empty && <div style={{ color: theme.textDim }}>{t("unavailable")}</div>}

      {/* 固定列数 × 后端取数条数 = 整行(歌单 12=6×2,新歌 12=3×4),不留残行 */}
      {data.playlists.length > 0 && (
        <Section title={t("recPlaylists")}>
          <Grid cols={6}>
            {data.playlists.map((pl) => (
              <PlaylistCard key={pl.id} pl={pl} onActivate={() => playPlaylist(pl)} />
            ))}
          </Grid>
        </Section>
      )}

      {data.newsongs.length > 0 && (
        <Section title={t("newSongs")}>
          <Grid cols={3}>
            {data.newsongs.map((s, i) => (
              <SongCell key={s.mid} song={s} onActivate={() => playQueue(data.newsongs, i)} />
            ))}
          </Grid>
        </Section>
      )}
    </div>
  );
}

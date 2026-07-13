// QQ 推荐页(P5a,效果图 qq-ui/01):智能电台大卡 ×2 + 推荐歌单网格 + 新歌首发网格。
// 电台卡 P5d(radio 队列模式)前置灰;歌单卡 A = 拉曲目整单入队开播。
// ponytail: 歌单详情页 P5c 再上,届时歌单卡 A 改进详情。

import { FaHeartbeat, FaSatelliteDish } from "react-icons/fa";

import { api } from "../../api";
import { reportError } from "../../errors";
import { t } from "../../i18n";
import { playQueue } from "../../player/usePlayer";
import { openRadioPage } from "../../screens/Immersive";
import { openPlaylistDetail } from "../../screens/PlaylistDetail";
import { ToplistSection } from "../../ui/ToplistSection";
import { Grid, HeroCard, PlaylistCard, Section, SongCell } from "../../ui/cards";
import { theme } from "../../ui/theme";
import { useAsync } from "../../ui/useAsync";

const QQ_GREEN = "#31c27c";

export function Recommend() {
  const data = useAsync(
    () =>
      api.getRecommend().catch((e) => {
        reportError(e instanceof Error ? e.message : String(e));
        return { playlists: [], newsongs: [] };
      }),
    []
  );

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
          <HeroCard
            title={t("guessYouLike")}
            subtitle={t("guessDesc")}
            icon={<FaHeartbeat />}
            accent={QQ_GREEN}
            onActivate={() => openRadioPage("qq_guess", t("guessYouLike"))}
          />
          <HeroCard
            title={t("radarRec")}
            subtitle={t("radarDesc")}
            icon={<FaSatelliteDish />}
            accent={QQ_GREEN}
            onActivate={() => openRadioPage("qq_radar", t("radarRec"))}
          />
        </div>
      </Section>

      {empty && <div style={{ color: theme.textDim }}>{t("unavailable")}</div>}

      {/* 固定列数 × 后端取数条数 = 整行(歌单 12=6×2,新歌 12=3×4),不留残行 */}
      {data.playlists.length > 0 && (
        <Section title={t("recPlaylists")}>
          <Grid cols={6}>
            {data.playlists.map((pl) => (
              <PlaylistCard key={pl.id} pl={pl} onActivate={() => openPlaylistDetail(pl)} />
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

      <ToplistSection />
    </div>
  );
}

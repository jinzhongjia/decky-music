// NCM 发现页(P5b,效果图 ncm-ui/02):每日推荐大卡(日期数字)+ 推荐歌单网格。
// 每日推荐需登录:未登录 A 触发后经 error code 提示去 QAM 扫码(errNotLoggedIn)。
// ponytail: 歌单详情页 P5c 再上,歌单卡 A 先整单入队开播;Banner 后置 P6。

import { api, errorText } from "../../api";
import { guard, reportError } from "../../errors";
import { t } from "../../i18n";
import { playQueue } from "../../player/usePlayer";
import { openPlaylistDetail } from "../../screens/PlaylistDetail";
import { usePageAutoFocus } from "../../ui/AppShell";
import { ToplistSection } from "../../ui/ToplistSection";
import { Grid, HeroCard, PlaylistCard, Section } from "../../ui/cards";
import { theme } from "../../ui/theme";
import { useAsync } from "../../ui/useAsync";

const NCM_RED = "#ec4141";

export function Discover() {
  const initialFocus = usePageAutoFocus();
  const data = useAsync(
    () =>
      api.getDiscover().catch((e) => {
        reportError(e instanceof Error ? e.message : String(e));
        return { playlists: [] };
      }),
    []
  );

  const playDaily = () =>
    guard(async () => {
      const r = await api.getDailySongs();
      if (r.ok && r.songs?.length) playQueue(r.songs, 0);
      else reportError(errorText(r.error || "provider_error"));
    });

  if (!data) {
    return <div style={{ margin: "auto", color: theme.textDim }}>{t("loading")}</div>;
  }

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
      <Section title={t("dailyRec")}>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <HeroCard
            title={t("dailyRec")}
            subtitle={t("dailyDesc")}
            icon={<span style={{ fontWeight: 800 }}>{new Date().getDate()}</span>}
            accent={NCM_RED}
            onActivate={playDaily}
            initialFocus={initialFocus}
          />
        </div>
      </Section>

      {data.playlists.length === 0 ? (
        <div style={{ color: theme.textDim }}>{t("unavailable")}</div>
      ) : (
        <Section title={t("recPlaylists")}>
          <Grid cols={6}>
            {data.playlists.map((pl) => (
              <PlaylistCard key={pl.id} pl={pl} onActivate={() => openPlaylistDetail(pl)} />
            ))}
          </Grid>
        </Section>
      )}

      <ToplistSection />
    </div>
  );
}

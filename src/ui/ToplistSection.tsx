// 榜单区块(P6,推荐页/发现页共用):官方榜单卡网格,点卡进榜单详情。
// 失败/空静默隐藏(榜单是补充入口,不打扰页面主内容)。

import { api } from "../api";
import { t } from "../i18n";
import { openToplistDetail } from "../screens/ToplistDetail";
import { Grid, PlaylistCard, Section } from "./cards";
import { useAsync } from "./useAsync";

export function ToplistSection() {
  const toplists = useAsync(
    () =>
      api
        .getToplists()
        .then((r) => (r.ok ? (r.toplists ?? []) : []))
        .catch(() => []),
    []
  );

  if (!toplists?.length) return null;
  return (
    <Section title={t("toplists")}>
      <Grid cols={6}>
        {toplists.map((top) => (
          <PlaylistCard key={top.id} pl={top} onActivate={() => openToplistDetail(top)} />
        ))}
      </Grid>
    </Section>
  );
}

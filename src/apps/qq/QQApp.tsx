// QQ 音乐 app。当前可填:搜索 / 正在播放。
// 推荐 / 我的音乐 / 智能电台 待内容接口(P5),届时在 tabs 里加页,见 specs/qq-ui.md。

import { t } from "../../i18n";
import { NowPlaying } from "../../screens/NowPlaying";
import { Search } from "../../screens/Search";
import { AppShell } from "../../ui/AppShell";

const QQ_GREEN = "#31c27c"; // 品牌色:仅 Logo/徽章点缀

export function QQApp() {
  return (
    <AppShell
      name={t("qq")}
      accent={QQ_GREEN}
      initial="search"
      tabs={[
        { id: "search", title: t("search"), content: <Search /> },
        { id: "nowplaying", title: t("nowPlaying"), content: <NowPlaying /> },
      ]}
    />
  );
}

// 网易云音乐 app(内容区)。当前可填:搜索 / 正在播放。
// 发现 / 私人FM / 我的 / 热评 待内容接口(P5),届时在 tabs 里加页,见 docs/ROADMAP.md、specs/ncm-ui.md。

import { t } from "../../i18n";
import { NowPlaying } from "../../screens/NowPlaying";
import { Search } from "../../screens/Search";
import { TabShell } from "../../ui/TabShell";

export function NCMApp() {
  return (
    <TabShell
      initial="search"
      tabs={[
        { id: "search", title: t("search"), content: <Search /> },
        { id: "nowplaying", title: t("nowPlaying"), content: <NowPlaying /> },
      ]}
    />
  );
}

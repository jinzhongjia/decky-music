// QQ 音乐 app(内容区)。当前可填:搜索 / 正在播放。
// 推荐 / 我的音乐 / 智能电台 待内容接口(P5),届时在 tabs 里加页,见 docs/ROADMAP.md、specs/qq-ui.md。

import { t } from "../../i18n";
import { NowPlaying } from "../../screens/NowPlaying";
import { Search } from "../../screens/Search";
import { TabShell } from "../../ui/TabShell";

export function QQApp() {
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

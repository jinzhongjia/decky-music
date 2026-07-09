// QQ 音乐 app。页签:推荐(默认)/ 搜索 / 正在播放。
// 我的音乐(P5e)/ 智能电台沉浸页(P5d)待接口,届时加页,见 specs/qq-ui.md、ROADMAP。

import { t } from "../../i18n";
import { NowPlaying } from "../../screens/NowPlaying";
import { Search } from "../../screens/Search";
import { AppShell } from "../../ui/AppShell";
import { Recommend } from "./Recommend";

const QQ_GREEN = "#31c27c"; // 品牌色:仅 Logo/徽章点缀

export function QQApp() {
  return (
    <AppShell
      name={t("qq")}
      accent={QQ_GREEN}
      initial="recommend"
      tabs={[
        { id: "recommend", title: t("recommend"), content: <Recommend /> },
        { id: "search", title: t("search"), content: <Search /> },
        { id: "nowplaying", title: t("nowPlaying"), content: <NowPlaying /> },
      ]}
    />
  );
}

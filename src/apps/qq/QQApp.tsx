// QQ 音乐 app。页签:推荐(默认)/ 搜索 / 我的音乐 / 正在播放(specs/qq-ui.md)。
// 智能电台沉浸页走独立路由(推荐页大卡进入)。

import { t } from "../../i18n";
import { NowPlaying } from "../../screens/NowPlaying";
import { Search } from "../../screens/Search";
import { AppShell } from "../../ui/AppShell";
import { MyMusic } from "./MyMusic";
import { Recommend } from "./Recommend";

const QQ_GREEN = "#31c27c"; // 品牌色:仅 Logo/徽章点缀

export function QQApp() {
  return (
    <AppShell
      name={t("qq")}
      accent={QQ_GREEN}
      tabs={[
        { id: "recommend", title: t("recommend"), content: <Recommend /> },
        { id: "search", title: t("search"), content: <Search /> },
        { id: "mymusic", title: t("myMusic"), content: <MyMusic /> },
        { id: "nowplaying", title: t("nowPlaying"), content: <NowPlaying /> },
      ]}
    />
  );
}

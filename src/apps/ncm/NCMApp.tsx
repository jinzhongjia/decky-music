// 网易云音乐 app。当前可填:搜索 / 正在播放。
// 发现 / 私人FM / 我的 / 热评 + 强制登录页 待内容接口(P5),见 specs/ncm-ui.md。

import { t } from "../../i18n";
import { NowPlaying } from "../../screens/NowPlaying";
import { Search } from "../../screens/Search";
import { AppShell } from "../../ui/AppShell";

const NCM_RED = "#ec4141"; // 品牌色:仅 Logo/徽章点缀

export function NCMApp() {
  return (
    <AppShell
      name={t("ncm")}
      accent={NCM_RED}
      initial="search"
      tabs={[
        { id: "search", title: t("search"), content: <Search /> },
        { id: "nowplaying", title: t("nowPlaying"), content: <NowPlaying /> },
      ]}
    />
  );
}
